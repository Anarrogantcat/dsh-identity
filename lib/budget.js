/**
 * 自适应预算：不锁死上限，按「当天花费 × 比例」给额度，带保底与可选硬顶。
 *
 *   allowance = min(可选上限, max(每日保底, 今日花费 × share × 剩余时段系数))
 *
 * · soft（默认）：按比例浮动
 * · hard：用你显式给的上限（留空=退回 soft 的算法）
 * · off：完全不调模型
 * · 预估用最近 5 次实际值的 EMA，单次预估超过额度 40% 就降级（不是直接取消）
 */
import { join } from 'node:path'
import { dirs, readJson, writeJson, audit } from './store.js'

const STATE_PATH = () => join(dirs.root, 'budget.json')
const pad = (n) => String(n).padStart(2, '0')
const today = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

export const BUDGET_DEFAULTS = {
  mode: 'soft',
  sharePercent: 15,
  floorTokens: 800,
  ceilingTokens: null,
  maxCallsPerDay: null,
  degradeRatio: 0.4,
}

export function loadBudgetState() {
  const j = readJson(STATE_PATH(), null)
  const base = { day: today(), calls: 0, ema: {}, last: null }
  if (!j || typeof j !== 'object') return base
  if (j.day !== today()) return { ...base, ema: j.ema ?? {} }
  return { ...base, ...j, ema: j.ema ?? {} }
}

function saveBudgetState(s) {
  try { writeJson(STATE_PATH(), s) } catch { /* ignore */ }
}

/** 归一化配置（允许来自面板/CONFIG，缺省走默认） */
export function normalizeBudget(cfg = {}) {
  const b = { ...BUDGET_DEFAULTS, ...(cfg?.budget ?? cfg ?? {}) }
  b.mode = ['soft', 'hard', 'off'].includes(b.mode) ? b.mode : 'soft'
  b.sharePercent = Math.min(100, Math.max(1, Number(b.sharePercent) || 15))
  b.floorTokens = Math.max(0, Number(b.floorTokens) || 0)
  b.ceilingTokens = b.ceilingTokens == null || b.ceilingTokens === '' ? null : Math.max(1, Number(b.ceilingTokens) || 0)
  b.maxCallsPerDay = b.maxCallsPerDay == null || b.maxCallsPerDay === '' ? null : Math.max(1, Number(b.maxCallsPerDay) || 0)
  b.degradeRatio = Math.min(0.9, Math.max(0.1, Number(b.degradeRatio) || 0.4))
  return b
}

/**
 * 算今天还剩多少 token 额度。
 * @param {{mode?:string, sharePercent?:number, floorTokens?:number, ceilingTokens?:number|null}} cfg
 * @param {{spentTodayTokens?:number, now?:Date}} ctx
 */
export function computeAllowance(cfg = {}, ctx = {}) {
  const b = normalizeBudget(cfg)
  const spent = Math.max(0, Number(ctx.spentTodayTokens) || 0)
  if (b.mode === 'off') return { allowanceTokens: 0, mode: b.mode, reason: '预算已关（off）' }
  if (b.mode === 'hard' && b.ceilingTokens != null) {
    return { allowanceTokens: b.ceilingTokens, mode: b.mode, reason: '硬顶 ' + b.ceilingTokens }
  }
  // soft（以及 hard 但没给上限时）
  const raw = spent * (b.sharePercent / 100)
  let allowance = Math.max(b.floorTokens, raw)
  if (b.ceilingTokens != null) allowance = Math.min(b.ceilingTokens, allowance)
  return {
    allowanceTokens: Math.round(allowance),
    mode: b.mode,
    reason: `soft：${spent} × ${b.sharePercent}% → ${Math.round(allowance)}（保底 ${b.floorTokens}${b.ceilingTokens != null ? '，上限 ' + b.ceilingTokens : ''}）`,
  }
}

/** 记录一次真实消耗，更新 EMA 与当日调用数 */
export function recordUsage(kind, tokens, meta = {}) {
  const s = loadBudgetState()
  const n = Math.max(0, Number(tokens) || 0)
  const k = String(kind || 'default')
  const prev = Number(s.ema?.[k])
  s.ema = { ...s.ema, [k]: Number.isFinite(prev) && prev > 0 ? prev * 0.6 + n * 0.4 : n }
  s.calls = Number(s.calls || 0) + 1
  s.last = { kind: k, tokens: n, at: Date.now(), ...meta }
  saveBudgetState(s)
  audit('budget.usage', { kind: k, tokens: n })
  return { ok: true, ema: s.ema[k], calls: s.calls }
}

/** 预估下一次调用的 token（EMA 优先，没有就用兜底值） */
export function estimateTokens(kind, fallback = 1200) {
  const s = loadBudgetState()
  const v = Number(s.ema?.[kind])
  return Number.isFinite(v) && v > 0 ? Math.round(v) : Math.max(1, Number(fallback) || 1200)
}

/**
 * 决定这次能不能调。
 * @returns {{allow:boolean, degrade:boolean, reason:string, allowanceTokens:number, estimateTokens:number}}
 */
export function decideCall(cfg, { kind = 'diary', estimate = null, spentTodayTokens = 0, hardStopped = false } = {}) {
  const b = normalizeBudget(cfg)
  const { allowanceTokens, reason: budgetReason } = computeAllowance(cfg, { spentTodayTokens })
  const est = Number.isFinite(Number(estimate)) ? Math.max(0, Number(estimate)) : estimateTokens(kind)
  const s = loadBudgetState()
  if (hardStopped) return { allow: false, degrade: false, reason: '全局花费硬闸已触发', allowanceTokens, estimateTokens: est }
  if (b.mode === 'off' || allowanceTokens <= 0) {
    return { allow: false, degrade: false, reason: '没有预算额度（' + budgetReason + '）', allowanceTokens, estimateTokens: est }
  }
  if (b.maxCallsPerDay != null && Number(s.calls || 0) >= b.maxCallsPerDay) {
    return { allow: false, degrade: false, reason: '今天调用次数到上限 ' + b.maxCallsPerDay, allowanceTokens, estimateTokens: est }
  }
  if (est > allowanceTokens * b.degradeRatio) {
    return { allow: true, degrade: true, reason: `预估 ${est} 超过额度的 ${Math.round(b.degradeRatio * 100)}%，降级为模板`, allowanceTokens, estimateTokens: est }
  }
  return { allow: true, degrade: false, reason: '预算允许（' + budgetReason + '）', allowanceTokens, estimateTokens: est }
}
