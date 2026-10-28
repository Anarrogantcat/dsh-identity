/**
 * 状态分层与晋升规则（纯函数）：ephemeral → tentative → durable。
 *
 * 用来回答一个关键问题：**什么时候一条认知才算「她的人格」，而不是「这一下的情绪」**。
 *
 *   · 1 次证据（尤其只有情绪事件）→ 只准 tentative，且会自动过期
 *   · ≥3 次独立证据、跨 ≥2 天 → 才允许 durable
 *   · 情绪事件不能单独把一条认知推成 durable
 *   · 冲突：两条 durable 互斥 → 双方降 tentative 并标记
 *
 * 纯函数，0 token，方便单测与回放。
 */

export const TENTATIVE_TTL_DAYS = 90
const DAY = 86400000

const ts = (v) => {
  const t = typeof v === 'number' ? v : Date.parse(String(v ?? ''))
  return Number.isFinite(t) ? t : 0
}

export function evidenceStats(evidence = [], now = Date.now()) {
  const list = (Array.isArray(evidence) ? evidence : []).filter((e) => e && e.at)
  const times = list.map((e) => ts(e.at)).filter(Boolean)
  const first = times.length ? Math.min(...times) : 0
  const last = times.length ? Math.max(...times) : 0
  const spanDays = first && last ? (last - first) / DAY : 0
  const kinds = new Set(list.map((e) => String(e.kind ?? '')))
  const moodOnly = list.length > 0 && list.every((e) => e.kind === 'feeling' || e.kind === 'mood')
  return { hits: list.length, first, last, spanDays, kinds: [...kinds], moodOnly, now }
}

/** 新建一条认知（默认 tentative，不直接 stable） */
export function makeTrait(partial = {}) {
  const at = partial.at ? new Date(partial.at).toISOString() : new Date().toISOString()
  return {
    id: String(partial.id ?? 't_' + Math.random().toString(16).slice(2, 8)),
    kind: String(partial.kind ?? 'preference'),
    text: String(partial.text ?? '').slice(0, 80),
    scope: String(partial.scope ?? 'global'),
    status: 'tentative',
    confidence: 0.35,
    evidence: [],
    firstSeen: at,
    lastConfirmed: at,
    hits: 0,
    conflict: false,
  }
}

/** 追加证据（按 ref 去重；最多留 20 条） */
export function addEvidence(trait, ev = {}, now = Date.now()) {
  const t = { ...trait, evidence: [...(trait.evidence ?? [])] }
  const at = ev.at ? new Date(ev.at).toISOString() : new Date(now).toISOString()
  const ref = ev.ref ? String(ev.ref) : ''
  if (ref && t.evidence.some((x) => x.ref === ref)) return t
  t.evidence.push({ at, kind: String(ev.kind ?? 'self-say'), ref, seq: ev.seq ?? null, note: ev.note ? String(ev.note).slice(0, 80) : '' })
  if (t.evidence.length > 20) t.evidence = t.evidence.slice(-20)
  t.hits = t.evidence.length
  t.lastConfirmed = at
  return recompute(t, now)
}

/** 依据证据重算状态与置信度 */
export function recompute(trait, now = Date.now()) {
  const t = { ...trait }
  const s = evidenceStats(t.evidence, now)
  t.hits = s.hits
  t.firstSeen = s.first ? new Date(s.first).toISOString() : t.firstSeen
  t.lastConfirmed = s.last ? new Date(s.last).toISOString() : t.lastConfirmed
  if (t.status === 'retired') return t

  // 情绪单独事件永远不够：moodOnly 不允许 durable
  const enough = s.hits >= 3 && s.spanDays >= 2 && !s.moodOnly
  if (enough) {
    t.status = 'durable'
    t.confidence = Math.min(0.95, 0.45 + 0.1 * s.hits + Math.min(0.2, s.spanDays * 0.03))
  } else {
    t.status = 'tentative'
    t.confidence = Math.min(0.6, 0.3 + 0.1 * s.hits)
  }
  return t
}

/** 冻结检测：只靠一次情绪/单次事件的"人格"必须降回 tentative */
export function freezeGuard(trait, now = Date.now()) {
  if (trait?.status !== 'durable') return trait
  const s = evidenceStats(trait.evidence, now)
  if (s.hits >= 3 && s.spanDays >= 2 && !s.moodOnly) return trait
  return { ...trait, status: 'tentative', confidence: Math.min(trait.confidence ?? 0.3, 0.45) }
}

/** tentative 到期自动退休（默认 90 天无新确认） */
export function expireTentative(trait, now = Date.now(), ttlDays = TENTATIVE_TTL_DAYS) {
  if (trait?.status !== 'tentative') return trait
  const last = ts(trait.lastConfirmed)
  if (last && now - last > ttlDays * DAY) return { ...trait, status: 'retired', retiredAt: new Date(now).toISOString() }
  return trait
}

/** 标记冲突：双方降 tentative 并打标 */
export function markConflict(a, b) {
  const stamp = { conflict: true, status: 'tentative', confidence: Math.min(a?.confidence ?? 0.3, b?.confidence ?? 0.3, 0.35) }
  return [{ ...a, ...stamp }, { ...b, ...stamp }]
}

/** Owner 否决：直接退休（保留证据供回看） */
export function retire(trait, reason = 'owner', now = Date.now()) {
  return { ...trait, status: 'retired', retireReason: String(reason), retiredAt: new Date(now).toISOString() }
}
