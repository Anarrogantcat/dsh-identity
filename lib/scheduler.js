/**
 * 调度器：所有「自动任务」的唯一出口。
 *
 * 统一做这些闸：
 *   1 来源闸：origin=bot 默认禁止跑模型类任务（防自己触发自己）
 *   2 幂等闸：同 key + runKey 同一天只成功一次；素材没更新就不跑
 *   3 状态机 + 租约：running 超过 leaseMs 自动回收，不会卡死
 *   4 退避熔断：失败重试有上限，连续失败当天禁用
 *   5 预算闸：交给调用方注入的 budgetCheck（预算不足/降级）
 *   6 并发闸：全局单并发，排队按优先级
 *   7 时间闸：单次执行超时强杀（Promise.race），并记录
 *   8 行为闸：由调用方传入的 runKey/幂等键承担（她的消息不产生自动任务）
 *
 * 任何一步不通过都返回结构化 skipped 原因，并写审计；绝不重试成死循环。
 */
import { join } from 'node:path'
import { dirs, readJson, writeJson, audit } from './store.js'

const STATE_PATH = () => join(dirs.root, 'scheduler.json')
const pad = (n) => String(n).padStart(2, '0')
const today = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const endOfDay = (now = Date.now()) => {
  const d = new Date(now)
  d.setHours(23, 59, 59, 999)
  return d.getTime()
}

export const SCHED_DEFAULTS = {
  leaseMs: 90 * 1000,
  execTimeoutMs: 120 * 1000,
  maxFails: 3,
  backoffBaseMs: 60 * 1000,
  allowBotOrigin: false,
}

const clone = (v) => JSON.parse(JSON.stringify(v))

function loadState() {
  const j = readJson(STATE_PATH(), null)
  const base = { tasks: {} }
  if (!j || typeof j !== 'object' || !j.tasks || typeof j.tasks !== 'object') return base
  return j
}
function saveState(s) {
  try { writeJson(STATE_PATH(), s) } catch { /* ignore */ }
}

/** 全局单并发：串行队列 */
let chain = Promise.resolve()
function enqueue(fn) {
  const p = chain.then(fn, fn)
  // 保持链不因异常中断
  chain = p.catch(() => {})
  return p
}

export function taskState(key) {
  const s = loadState()
  return s.tasks[key] ? clone(s.tasks[key]) : null
}

export function resetTask(key) {
  const s = loadState()
  delete s.tasks[key]
  saveState(s)
}

/**
 * 跑一个自动任务。
 * @param {{key:string, kind?:string, origin?:string, runKey?:string, estimate?:number,
 *          budgetCheck?:(ctx:object)=>{allow:boolean,degrade?:boolean,reason?:string},
 *          timeoutMs?:number, allowBotOrigin?:boolean, now?:number}} opts
 * @param {(ctx:object)=>Promise<any>} fn
 * @returns {Promise<{ran:boolean, skipped?:boolean, reason?:string, degrade?:boolean, result?:any, error?:string, ms?:number}>}
 */
export function runTask(opts, fn) {
  return enqueue(async () => {
    const started = Date.now()
    const now = Number(opts.now) || started
    const key = String(opts.key ?? '')
    const kind = String(opts.kind ?? 'task')
    const origin = String(opts.origin ?? 'timer')
    const runKey = String(opts.runKey ?? `${kind}:${today(new Date(now))}`)
    const cfg = { ...SCHED_DEFAULTS, ...(opts.sched ?? {}) }
    if (!key) return { ran: false, skipped: true, reason: '缺少 key' }
    if (origin === 'bot' && !(opts.allowBotOrigin ?? cfg.allowBotOrigin)) {
      audit('sched.skip', { key, kind, why: 'bot-origin' })
      return { ran: false, skipped: true, reason: '来源是 bot，禁止触发自动任务' }
    }

    const s = loadState()
    const t = s.tasks[key] ?? {}

    // 租约：正在跑且没过期 → 跳过
    if (Number(t.leaseUntil ?? 0) > now) {
      return { ran: false, skipped: true, reason: '任务正在运行（租约未过期）' }
    }
    // 熔断：今天被禁用
    if (Number(t.disabledUntil ?? 0) > now) {
      return { ran: false, skipped: true, reason: '连续失败已禁用，今天不再跑' }
    }
    // 退避
    if (Number(t.nextAllowedAt ?? 0) > now) {
      return { ran: false, skipped: true, reason: '退避中，等 ' + Math.ceil((t.nextAllowedAt - now) / 1000) + ' 秒' }
    }
    // 幂等：同一天同 runKey 已成功
    if (t.lastDay === today(new Date(now)) && t.lastRunKey === runKey && t.ok) {
      return { ran: false, skipped: true, reason: '今天已经跑过（幂等）' }
    }
    // 预算
    if (typeof opts.budgetCheck === 'function') {
      const b = opts.budgetCheck({ key, kind, estimate: Number(opts.estimate) || 0, now }) || {}
      if (!b.allow) {
        audit('sched.skip', { key, kind, why: 'budget', reason: String(b.reason ?? '') })
        return { ran: false, skipped: true, reason: String(b.reason ?? '预算不足') }
      }
      if (b.degrade) {
        audit('sched.skip', { key, kind, why: 'degrade', reason: String(b.reason ?? '') })
        return { ran: false, skipped: true, degrade: true, reason: String(b.reason ?? '预算不足，改走降级路径') }
      }
    }

    // 占租约
    s.tasks[key] = { ...t, leaseUntil: now + cfg.leaseMs, running: true }
    saveState(s)

    const timeout = Number(opts.timeoutMs) || cfg.execTimeoutMs
    let result
    let error = null
    let timer = null
    try {
      const work = Promise.resolve().then(() => fn({ key, kind, runKey, now }))
      const timeoutPromise = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('执行超时')), timeout) })
      result = await Promise.race([work, timeoutPromise])
    } catch (err) {
      error = String(err?.message ?? err)
    } finally {
      if (timer) clearTimeout(timer)
    }

    const fin = loadState()
    const cur = fin.tasks[key] ?? {}
    const ms = Date.now() - started
    if (error) {
      const fails = Number(cur.fails ?? 0) + 1
      const disabled = fails >= cfg.maxFails
      fin.tasks[key] = {
        ...cur,
        running: false,
        leaseUntil: 0,
        ok: false,
        fails,
        lastError: error.slice(0, 200),
        lastAt: Date.now(),
        disabledUntil: disabled ? endOfDay(Date.now()) : 0,
        nextAllowedAt: disabled ? 0 : Date.now() + cfg.backoffBaseMs * Math.pow(2, Math.max(0, fails - 1)),
      }
      saveState(fin)
      audit('sched.fail', { key, kind, fails, error: error.slice(0, 120), ms })
      return { ran: true, error, ms }
    }
    fin.tasks[key] = {
      ...cur,
      running: false,
      leaseUntil: 0,
      ok: true,
      fails: 0,
      lastDay: today(new Date(now)),
      lastRunKey: runKey,
      lastAt: Date.now(),
      disabledUntil: 0,
      nextAllowedAt: 0,
    }
    saveState(fin)
    audit('sched.run', { key, kind, ms })
    return { ran: true, ms, result }
  })
}
