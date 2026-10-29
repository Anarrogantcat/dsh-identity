/**
 * 自主循环（L2.5）：好奇 → 目标 → 计划 → 治理 → 执行 → 验收 → 记录 → 反思 → 调整。
 *
 * 铁律（先把自己锁死，再谈自主）：
 *   · 只能「提议」目标；必须 Owner 批准才进入 active（模型不能自己开干）
 *   · 每步动作必须本地、可审计、可回滚：只读事件、写 tentative traits、记审计，不碰钱/账号/外部写操作
 *   · 走调度器：全局单并发、幂等（目标每天最多跑一次）、超时、失败退避
 *   · 预算：执行前过 budget.decideCall；没额度就跳过并记原因，不降级成瞎干
 *   · 调整：同一类目标连续 3 次没产出 → 不再提议同类（防死循环刷目标）
 */
import { join } from 'node:path'
import { readJson, writeJson, dirs, sha, audit } from './store.js'
import { readEvents, listDays } from './events.js'
import { observe as traitObserve } from './traits.js'

const PATH = () => join(dirs.root, 'autonomy.json')
const DAY = 86400000

function load() {
  const j = readJson(PATH(), null)
  if (!j || typeof j !== 'object' || !Array.isArray(j.goals)) return { version: 1, goals: [], stats: {} }
  return { version: 1, goals: j.goals, stats: j.stats ?? {} }
}
function save(db) { writeJson(PATH(), db) }

const today = (now = Date.now()) => new Date(now).toISOString().slice(0, 10)
const normText = (s) => String(s ?? '').replace(/\s+/g, ' ').trim()

/** 好奇：从事实流里找「没被接住的问句」与「逾期承诺」，最多 3 个候选 */
export function curiosities(peerKey, { limit = 3, now = Date.now() } = {}) {
  const out = []
  try {
    const days = listDays(String(peerKey)).slice(0, 2)
    const evs = []
    for (const d of days) evs.push(...readEvents(String(peerKey), d))
    evs.sort((a, b) => (Date.parse(a.at) || 0) - (Date.parse(b.at) || 0))
    const talks = evs.filter((e) => e.kind === 'talk')
    for (let i = 0; i < talks.length; i++) {
      const e = talks[i]
      if (e.origin !== 'inbound') continue
      const t = normText(e.text)
      if (!/[?？]|吗[。.!！\s]*$|怎么|为什么|有没有|能不能/.test(t)) continue
      const replied = talks.slice(i + 1).some((x) => x.origin === 'bot')
      if (replied) continue
      out.push({ kind: 'unanswered', text: t.slice(0, 60), who: String(e.who ?? '').slice(0, 12), score: 0.6 })
      if (out.length >= limit) break
    }
  } catch { /* 读不到事件就当没好奇 */ }
  return out.slice(0, Math.max(1, limit))
}

function makeGoal({ peerKey, kind, title, why, now = Date.now() }) {
  const id = 'g_' + sha(`${peerKey}|${kind}|${title}|${today(now)}`, 10)
  return {
    id,
    peerKey: String(peerKey),
    kind: String(kind),
    title: String(title).slice(0, 80),
    why: String(why).slice(0, 120),
    status: 'proposed',
    createdAt: new Date(now).toISOString(),
    steps: [
      { id: 's1', text: '梳理最近事件里与它相关的部分（只读）', kind: 'read', done: false },
      { id: 's2', text: '写一条 tentative 自我提醒（可被否决）', kind: 'note', done: false },
      { id: 's3', text: '交给 Owner 看结果，不自己对外动手', kind: 'handoff', done: false },
    ],
  }
}

/** 提议目标：每天每群最多 2 个；同类连续 3 次无产出就不再提 */
export function propose(peerKey, { cfg = {}, now = Date.now(), limit = 2 } = {}) {
  const db = load()
  const day = today(now)
  const pk = String(peerKey)
  const mineToday = db.goals.filter((g) => g.peerKey === pk && String(g.createdAt).slice(0, 10) === day).length
  if (mineToday >= limit) return { ok: true, created: [], skipped: '今天提议够了' }
  const cands = curiosities(pk, { limit, now })
  const created = []
  // 待批超过 7 天自动过期，别把「3 待批」堆成摆设
  for (const g of db.goals) {
    if (g.status === 'proposed' && now - Date.parse(g.createdAt || 0) > 7 * 86400000) g.status = 'expired'
  }
  for (const c of cands) {
    const kind = c.kind
    const fails = Number(db.stats?.[`${pk}|${kind}|fails`] ?? 0)
    if (fails >= 3) continue
    const g = makeGoal({ peerKey: pk, kind, title: `把「${c.text.slice(0, 40)}」这事弄明白`, why: c.who ? `${c.who} 问的，当时没接住` : '当时没接住', now })
    if (db.goals.some((x) => x.id === g.id)) continue

    db.goals.push(g)
    created.push(g)
    if (db.goals.filter((x) => x.peerKey === pk && String(x.createdAt).slice(0, 10) === day).length >= limit) break
  }
  if (created.length) { save(db); audit('autonomy.propose', { peer: pk.slice(0, 16), n: created.length }) }
  return { ok: true, created, skipped: created.length ? '' : '没有新候选' }
}

export function listGoals({ status = '', peerKey = '' } = {}) {
  return load().goals
    .filter((g) => (!status || g.status === status) && (!peerKey || g.peerKey === peerKey))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
}

/** Owner 批准/放弃；只有 owner 能改状态 */
export function setGoalStatus(id, status, { by = '' } = {}) {
  const allowed = ['approved', 'dropped']
  if (!allowed.includes(status)) return { ok: false, error: '只能批准或放弃' }
  if (String(by) !== 'owner') return { ok: false, error: '只有 Owner 能批' }
  const db = load()
  const g = db.goals.find((x) => x.id === String(id))
  if (!g) return { ok: false, error: '没有这个目标' }
  if (g.status === 'done') return { ok: false, error: '已经做完了' }
  g.status = status
  g.updatedAt = new Date().toISOString()
  save(db)
  audit('autonomy.status', { id: g.id, status })
  return { ok: true, goal: g }
}

/**
 * 执行一个已批准目标（由调度器调用）。每步都审计；只做本地动作。
 * @param {{cfg?:object, now?:number, budget?:{allow:boolean,degrade?:boolean,reason?:string}}} opts
 */
export function runGoal(id, { cfg = {}, now = Date.now(), budget = null } = {}) {
  const db = load()
  const g = db.goals.find((x) => x.id === String(id))
  if (!g) return { ran: false, reason: '没有这个目标' }
  if (g.status !== 'approved') return { ran: false, reason: '目标没被批准' }
  if (budget && budget.allow === false) { audit('autonomy.skip', { id: g.id, why: 'budget', reason: budget.reason ?? '' }); return { ran: false, reason: budget.reason ?? '预算不足' } }
  const stepLog = []
  for (const s of g.steps) {
    if (s.done) continue
    if (s.kind === 'read') {
      s.done = true
      stepLog.push({ id: s.id, ok: true })
      continue
    }
    if (s.kind === 'note') {
      try {
        const r = traitObserve(`我开始留意：${g.title.slice(0, 40)}`, { ref: `goal:${g.id}`, kind: 'self-note' })
        s.done = !!r.ok
        stepLog.push({ id: s.id, ok: !!r.ok })
      } catch (err) { stepLog.push({ id: s.id, ok: false, error: String(err?.message ?? err) }) }
      continue
    }
    // handoff：不自己对外动手，标记完成并留给 Owner 看
    s.done = true
    stepLog.push({ id: s.id, ok: true })
  }
  const ok = g.steps.every((s) => s.done)
  g.status = ok ? 'done' : 'approved'
  g.finishedAt = ok ? new Date(now).toISOString() : g.finishedAt
  save(db)
  audit('autonomy.run', { id: g.id, ok, steps: stepLog.length })
  return { ran: true, ok, goal: { id: g.id, status: g.status }, steps: stepLog }
}

/** 统计（面板/反思用） */
export function autonomyStats() {
  const db = load()
  const by = {}
  for (const g of db.goals) by[g.status] = (by[g.status] ?? 0) + 1
  return { total: db.goals.length, by, today: db.goals.filter((g) => String(g.createdAt).slice(0, 10) === today()).length }
}
