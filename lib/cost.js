/**
 * 花费闸：今天花了多少 / 有没有超、超了怎么办
 *
 * 设计：**默认关闭**（usage.hardLimitEnabled=false），由用户自己打开。
 *   - off      ：只显示金额，不拦
 *   - degrade  ：超预算后不再调模型，回一句 0 token 的模板
 *   - mute     ：超预算后直接静默（不回任何闲聊）
 */
import { usageReport } from './usage.js'
import { readJson, writeJson, dirs } from './store.js'
import { join } from 'node:path'

const STATE = join(dirs.root, 'cost-guard.json')

const todayStr = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
}

function loadState() {
  const j = readJson(STATE, null)
  const today = todayStr()
  if (!j || j.date !== today) return { date: today, warned: false, degradeAt: 0, muteAt: 0 }
  return { warned: false, degradeAt: 0, muteAt: 0, ...j }
}

function saveState(s) { writeJson(STATE, s) }

export const DEGRADE_TEXT = '今天 token 花超了，本鱼先省着点——明天再聊。'
export const WARN_TEXT = (spent, limit) => '提醒一下：今天已经花了 ¥' + spent.toFixed(2) + '（上限 ¥' + limit.toFixed(2) + '），再聊就超了。'

/** 读今天的真实花费；拿不到就返回 null（不拦） */
export function spendToday(cfg) {
  try {
    const r = usageReport(cfg)
    if (!r?.ok) return null
    return Number(r.totals?.yuan ?? 0)
  } catch { return null }
}

/**
 * 判定当前状态：
 *   { enabled, state: 'off'|'ok'|'warn'|'exceed'|'unknown', spent, limit, action }
 */
export function budgetState(cfg) {
  const u = cfg?.usage ?? {}
  const enabled = u.hardLimitEnabled === true
  const limit = Number(u.dailyYuanHardLimit ?? 2)
  const action = String(u.onExceed ?? 'degrade') === 'mute' ? 'mute' : 'degrade'
  const warnAt = Number(u.warnAt ?? 0.8)
  if (!enabled) return { enabled: false, state: 'off', spent: null, limit, action }
  const spent = spendToday(cfg)
  if (spent == null) return { enabled: true, state: 'unknown', spent: null, limit, action }
  if (limit > 0 && spent >= limit) return { enabled: true, state: 'exceed', spent, limit, action }
  if (limit > 0 && spent >= limit * warnAt) return { enabled: true, state: 'warn', spent, limit, action }
  return { enabled: true, state: 'ok', spent, limit, action }
}

/** 超预算后该不该拦；拦的话是回模板还是静默（带节流：同一状态 30 分钟最多一次） */
export function gateDecision(cfg, now = Date.now()) {
  const b = budgetState(cfg)
  if (!b.enabled || (b.state !== 'exceed' && b.state !== 'warn')) return { block: false, ...b }
  const st = loadState()
  if (b.state === 'exceed') {
    const throttleMs = 30 * 60 * 1000
    const last = Number(st.degradeAt ?? 0)
    const speak = b.action === 'degrade' && now - last > throttleMs
    if (speak) { st.degradeAt = now; saveState(st) }
    return { block: true, speak, text: DEGRADE_TEXT, ...b }
  }
  // warn：只提醒一次
  if (!st.warned) {
    st.warned = true
    saveState(st)
    return { block: false, notifyOwner: true, text: WARN_TEXT(b.spent ?? 0, b.limit), ...b }
  }
  return { block: false, ...b }
}

export function resetCostGuard() {
  saveState({ date: todayStr(), warned: false, degradeAt: 0, muteAt: 0 })
  return true
}
