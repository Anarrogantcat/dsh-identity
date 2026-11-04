/**
 * 状态分层与晋升规则（纯函数）：ephemeral → tentative → durable。
 *
 * 用来回答一个关键问题：**什么时候一条认知才算「她的人格」，而不是「这一下的情绪」**。
 *
 *   · 1 次证据（尤其只有情绪事件）→ 只准 tentative，且会自动过期
 *   · ≥3 次独立证据 → 就允许 durable（不再卡跨天：成长不该被日历按住）
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
  // 「被确认」不是行为证据，是旁证：判断独立性/纯情绪时不计入
  const own = list.filter((e) => String(e.kind ?? '') !== 'confirm')
  const moodOnly = own.length > 0 && own.every((e) => e.kind === 'feeling' || e.kind === 'mood')
  // 独立性：同一天 + 同一个来源只算一次。
  // 同一天把一句口头禅说三遍，不是三次证据——正常人不会因此认定自己就是这样的人。
  // 来源优先用「谁说的」；老数据没有 by 时退回 kind，兼容历史。
  const cells = new Set()
  const days = new Set()
  for (const e of own) {
    const day = String(e.at).slice(0, 10)
    days.add(day)
    const src = e.by ? 'by:' + e.by : 'kind:' + String(e.kind ?? 'self-say')
    cells.add(`${day}|${src}`)
  }
  return { hits: list.length, ownHits: own.length, first, last, spanDays, kinds: [...kinds], moodOnly, independent: cells.size, days: days.size, now }
}

/** 口头禅 / 承诺：说说而已，不是人格 */
const CATCHPHRASE_KINDS = new Set(['promise'])
const CATCHPHRASE_RE = /记得|别忘了|明天|回头|待会|稍后|马上|改天|下次再/
export function isCatchphrase(trait) {
  if (CATCHPHRASE_KINDS.has(String(trait?.kind ?? ''))) return true
  return CATCHPHRASE_RE.test(String(trait?.text ?? ''))
}
/** 人格是稀有的：正常人不会给自己贴五十个标签 */
export const MAX_DURABLE = 12

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
    // 认知链：这条认知被谁确认过 / 被谁否过（证据之外的另一条线，复盘时回填）
    confirmedBy: [],
    refutedBy: [],
  }
}

/** 追加证据（按 ref 去重；最多留 20 条） */
export function addEvidence(trait, ev = {}, now = Date.now()) {
  const t = { ...trait, evidence: [...(trait.evidence ?? [])] }
  const at = ev.at ? new Date(ev.at).toISOString() : new Date(now).toISOString()
  const ref = ev.ref ? String(ev.ref) : ''
  if (ref && t.evidence.some((x) => x.ref === ref)) return t
  t.evidence.push({
    at,
    kind: String(ev.kind ?? 'self-say'),
    ref,
    // 来源：谁说的（QQ 号 / peer / channel）。独立证据按「天 × 来源」去重，
    // 以前这里没有来源、只能拿 kind 顶，结果同一天同一类证据永远只算一次，
    // 人格永远到不了 3 格。现在不同人/不同渠道各算一格。
    by: ev.by ? String(ev.by).slice(0, 32) : '',
    seq: ev.seq ?? null,
    note: ev.note ? String(ev.note).slice(0, 80) : '',
  })
  if (t.evidence.length > 20) t.evidence = t.evidence.slice(-20)
  t.hits = t.evidence.length
  t.lastConfirmed = at
  return recompute(t, now)
}

/** 认知链：一次「确认」——记进 confirmedBy（按 ref 去重），同时算一次证据 */
export function confirmWith(trait, ev = {}, now = Date.now()) {
  const t = { ...trait, confirmedBy: [...(trait.confirmedBy ?? [])] }
  const ref = String(ev.ref ?? '')
  const at = ev.at ? new Date(ev.at).toISOString() : new Date(now).toISOString()
  if (ref && t.confirmedBy.some((x) => x.ref === ref)) return t
  t.confirmedBy.push({ at, ref, by: String(ev.by ?? 'user'), note: ev.note ? String(ev.note).slice(0, 60) : '' })
  if (t.confirmedBy.length > 20) t.confirmedBy = t.confirmedBy.slice(-20)
  return addEvidence(t, { ref: ref ? 'confirm:' + ref : '', kind: 'confirm', at, note: ev.note }, now)
}

/**
 * 认知链：一次「否认」——记进 refutedBy。
 * 不追加证据：否认不是支持，加进去反而会把「被否过的推断」抬成 durable。
 */
export function refuteWith(trait, ev = {}, now = Date.now()) {
  const t = { ...trait, refutedBy: [...(trait.refutedBy ?? [])] }
  const ref = String(ev.ref ?? '')
  const at = ev.at ? new Date(ev.at).toISOString() : new Date(now).toISOString()
  if (ref && t.refutedBy.some((x) => x.ref === ref)) return t
  t.refutedBy.push({ at, ref, reason: String(ev.reason ?? 'contradicted').slice(0, 40) })
  if (t.refutedBy.length > 20) t.refutedBy = t.refutedBy.slice(-20)
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

  // 「正常人」口径：
  //   · 同一场合重复不算新证据（independent 按「天 × 来源」去重）
  //   · 得有人当面认过（confirmedBy 里至少一条 by=user），纯自我感觉不上位
  //   · 承诺 / 口头禅永远不进人格
  const external = (t.confirmedBy ?? []).some((x) => x && x.by === 'user')
  const enough = s.independent >= 3 && !s.moodOnly && external && !isCatchphrase(t)
  if (enough) {
    t.status = 'durable'
    t.stale = false
    t.confidence = Math.min(0.95, 0.45 + 0.1 * s.hits + Math.min(0.2, s.spanDays * 0.03))
  } else if (t.status !== 'durable') {
    t.status = 'tentative'
    t.confidence = Math.min(0.6, 0.3 + 0.1 * s.hits)
  } else {
    // 不追溯降级：老的人格不因为新规矩当场塌掉，只标出来等复核
    t.stale = true
  }
  // 认知链：被明确否掉的次数压过确认次数，就别再当人格了。
  // 否认不删证据——错也要留痕，下次别再犯同样的推断。
  const refuted = (t.refutedBy?.length ?? 0)
  const confirmed = (t.confirmedBy?.length ?? 0)
  if (refuted >= 2 && refuted >= confirmed) {
    t.status = 'tentative'
    t.confidence = Math.min(t.confidence ?? 0.3, 0.3)
  }
  return t
}

/** 冻结检测：只靠一次情绪/单次事件的"人格"必须降回 tentative */
export function freezeGuard(trait, now = Date.now()) {
  if (trait?.status !== 'durable') return trait
  const s = evidenceStats(trait.evidence, now)
  if (s.hits >= 3 && !s.moodOnly) return trait
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
