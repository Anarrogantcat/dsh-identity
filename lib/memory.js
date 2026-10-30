/**
 * 半衰期记忆（算法思路借鉴 Yuuyuko-uu/dsh-fish-memory 的「鲜活度 + 强化」设计，实现为本插件自写）
 *   H = base × (1 + 2I)         半衰期随重要性延长（30 → 90 天）
 *   A = A0 × 2^(−Δ/H)           鲜活度，Δ 从「最后一次被提起」算
 *   E = emotion × 2^(−Δ/7)      情绪衰减更快
 *   C = s/(s+K)                 相关度（稀有词加权命中）
 *   P = C × (w0 + w1·A + w2·I + w3·E)
 * 只淡忘不删除；stable_profile 不衰减。
 *
 * 出处（后补）：每条记忆带 origin（谁说的）+ quote（原话）+ by（谁）+ status。
 *   origin = user（群友亲口说的）/ agent（本鱼自己概括的）/ web（网上看的）/ system
 *   注入只取 active；agent 的带 [自记] 标出来；群友亲口复述会把推断升级成事实。
 * 改口：correctMemory 不覆盖原条，旧的标 superseded 并指向新条，旧的不再注入。
 */
import { join } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { readJson, writeJson, dirs, sha, appendJsonl, audit } from './store.js'
import { valence as moodValence } from './moodv2.js'

const DAY = 86400000
export const CATEGORIES = ['event', 'preference', 'promise', 'fact', 'mood', 'stable_profile']
/** 记忆出处：群友亲口 / 本鱼自己概括 / 网上资料 / 系统内部 */
export const ORIGINS = ['user', 'agent', 'web', 'system']
const ORIGIN_OF_SOURCE = {
  group: 'user', c2c: 'user', auto: 'user', manual: 'user', member: 'user', web: 'user',
  marker: 'agent', diary: 'agent', compact: 'agent', reflection: 'agent', self: 'agent',
  system: 'system',
}
/** 老数据没有 origin 字段：按 source 推回去，未知的当「群友说的」（保守，宁可多信人） */
export function normalizeOrigin(origin, source) {
  const o = String(origin || '')
  if (ORIGINS.includes(o)) return o
  return ORIGIN_OF_SOURCE[String(source || '')] || 'user'
}
const originOfItem = (i) => normalizeOrigin(i?.origin, i?.source)

/** 全量卡（只存档、永不注入）：<memory>/<peerKey>.full.jsonl */
const fullPathOf = (peerKey) => join(dirs.memory, `${peerKey}.full.jsonl`)
/** 水位只提醒一次：level:peerKey:day */
const levelWarned = new Set()

function pathOf(peerKey) {
  return join(dirs.memory, `${peerKey}.json`)
}

function load(peerKey) {
  const db = readJson(pathOf(peerKey), null)
  if (db && Array.isArray(db.items)) return db
  return { items: [], df: {}, n: 0 }
}

function save(peerKey, db) {
  try { writeJson(pathOf(peerKey), db) } catch { /* ignore */ }
}

// ── 分词：CJK 二元组 + ASCII 词（够用且不需要词典）──
export function tokenize(text) {
  const out = new Set()
  const s = String(text ?? '').toLowerCase()
  for (const m of s.matchAll(/[a-z0-9_]{2,}/g)) out.add(m[0])
  const cjk = s.replace(/[^\u4e00-\u9fa5]+/g, ' ')
  for (const chunk of cjk.split(' ')) {
    if (!chunk) continue
    if (chunk.length === 1) out.add(chunk)
    for (let i = 0; i < chunk.length - 1; i++) out.add(chunk.slice(i, i + 2))
  }
  return [...out]
}

const clamp01 = (n) => Math.min(1, Math.max(0, Number(n) || 0))

export function addMemory(peerKey, { text, category = 'event', importance = 0.5, emotion = 0, valence = 0, at = null, source = '', msgId = '', origin = '', by = '', quote = '', supersedes = '' }, cfg) {
  const clean = String(text ?? '').trim()
  if (clean.length < 2) return null
  const db = load(peerKey)
  const id = sha(`${peerKey}:${clean}`, 16)
  const o = normalizeOrigin(origin, source)
  const exist = db.items.find((i) => i.id === id)
  if (exist) {
    // 重复提及 = 强化
    exist.hits = (exist.hits ?? 1) + 1
    exist.activation0 = clamp01((exist.activation0 ?? 1) + (cfg?.memory?.reinforce ?? 0.2) * (1 - (exist.activation0 ?? 1)))
    exist.activationAnchor = new Date().toISOString()
    // 本鱼推断过的，群友亲口说了同样的话 → 升级成事实
    if (originOfItem(exist) === 'agent' && o === 'user') {
      exist.origin = 'user'
      exist.confirmedAt = new Date().toISOString()
      if (by) exist.by = String(by).slice(0, 32)
      if (quote) exist.quote = String(quote).slice(0, 160)
    }
    save(peerKey, db)
    return exist
  }
  const item = {
    id,
    text: clean.slice(0, 600),
    category: CATEGORIES.includes(category) ? category : 'event',
    importance: clamp01(importance),
    emotion: clamp01(emotion),
    valence: Math.max(-1, Math.min(1, Number(valence) || 0)),
    at: at ?? new Date().toISOString(),
    createdAt: new Date().toISOString(),
    activation0: 1,
    activationAnchor: new Date().toISOString(),
    hits: 1,
    source,
    msgId,
    origin: o,
    by: String(by || '').slice(0, 32),
    quote: String(quote || '').slice(0, 160),
    status: 'active',
    supersedes: String(supersedes || ''),
    pinned: false,
  }
  db.items.push(item)
  // 双卡：全量卡只追加存档（永不注入、按天保留），衰减卡才进提示词
  try { appendJsonl(fullPathOf(peerKey), { ...item, kind: 'add', archivedAt: new Date().toISOString() }) } catch { /* 存档失败不挡记忆 */ }
  for (const w of tokenize(clean)) db.df[w] = (db.df[w] ?? 0) + 1
  db.n += 1
  // 容量：按 P 淘汰最低；pinned / stable_profile 永远不裁（durable 不硬删）
  const cap = Math.max(10, Number(cfg?.memory?.maxPerPeer ?? 500))
  if (db.items.length > cap) {
    const keepFirst = db.items.filter((i) => i.pinned || i.category === 'stable_profile')
    const rest = db.items.filter((i) => !(i.pinned || i.category === 'stable_profile'))
      .map((i) => ({ i, p: scoreOf(i, '', cfg, Date.now()).P }))
      .sort((a, b) => b.p - a.p)
      .slice(0, Math.max(0, cap - keepFirst.length))
      .map((x) => x.i)
    db.items = [...keepFirst, ...rest]
  }
  save(peerKey, db)
  memoryWatermark(peerKey, db.items.length, cap)
  return item
}

/** 水位：80/90/100%，每 peer 每档每天最多提醒一次（只审计，不删 durable） */
function memoryWatermark(peerKey, used, cap) {
  try {
    const ratio = cap > 0 ? used / cap : 0
    const level = ratio >= 1 ? 100 : ratio >= 0.9 ? 90 : ratio >= 0.8 ? 80 : 0
    if (!level) return
    const day = new Date().toISOString().slice(0, 10)
    const key = level + ':' + peerKey + ':' + day
    if (levelWarned.has(key)) return
    levelWarned.add(key)
    audit('memory.watermark', { peer: String(peerKey).slice(0, 16), level, used, cap })
  } catch { /* ignore */ }
}

/** 全量卡读取（面板/按需翻查用；绝不进提示词） */
export function fullCard(peerKey, limit = 200) {
  try {
    const p = fullPathOf(peerKey)
    if (!existsSync(p)) return []
    return readFileSync(p, 'utf8').split('\n').filter(Boolean).slice(-limit).map((l) => {
      try { return JSON.parse(l) } catch { return null }
    }).filter(Boolean)
  } catch { return [] }
}

function freshness(item, cfg, now) {
  if (item.category === 'stable_profile' || item.pinned) return 1
  const H = (cfg?.memory?.baseHalfLifeDays ?? 30) * (1 + 2 * clamp01(item.importance))
  const anchor = Date.parse(item.activationAnchor ?? item.at ?? item.createdAt ?? '') || now
  const days = Math.max(0, (now - anchor) / DAY)
  const A0 = clamp01(item.activation0 ?? 1)
  return A0 * Math.pow(2, -days / H)
}

function relevance(item, query, db) {
  const q = tokenize(query)
  if (q.length === 0) return 0
  const mWords = new Set(tokenize(item.text))
  const n = db.n || 0
  const top = Math.log(n + 1) || 1
  let s = 0
  for (const w of q) {
    if (!mWords.has(w)) continue
    const df = db.df[w] ?? 1
    const rarity = Math.min(1, Math.max(0, Math.log((n + 1) / (df + 1)) / top))
    s += rarity + 0.15 // 保底分，避免全部为 0
  }
  return s / (s + 1)
}

export function scoreOf(item, query, cfg, now = Date.now()) {
  const w = cfg?.memory ?? {}
  const C = relevance(item, query, load('__none__'))
  const A = freshness(item, cfg, now)
  const I = clamp01(item.importance)
  const days = Math.max(0, (now - (Date.parse(item.at ?? item.createdAt ?? '') || now)) / DAY)
  const E = clamp01(item.emotion) * Math.pow(2, -days / (w.emotionHalfLifeDays ?? 7))
  const P = C * ((w.wBaseline ?? 0.05) + (w.wActivation ?? 0.45) * A + (w.wImportance ?? 0.35) * I + (w.wEmotion ?? 0.15) * E)
  return { C, A, E, I, P }
}

/** 召回：按 C 过门槛，再按 P 排序；命中即强化 */
export function recall(peerKey, query, cfg, top = 5) {
  const db = load(peerKey)
  if (db.items.length === 0) return []
  const minC = cfg?.memory?.recallMinC ?? 0.15
  const now = Date.now()
  const w = cfg?.memory ?? {}
  const hasQuery = String(query ?? '').trim().length > 0
  const mv = moodValence()
  const alive = db.items.filter((i) => (i.status ?? 'active') !== 'superseded')
  const scored = alive.map((i) => {
    const C = hasQuery ? relevance(i, query, db) : 1
    const A = freshness(i, cfg, now)
    const I = clamp01(i.importance)
    const days = Math.max(0, (now - (Date.parse(i.at ?? i.createdAt ?? '') || now)) / DAY)
    const E = clamp01(i.emotion) * Math.pow(2, -days / (w.emotionHalfLifeDays ?? 7))
    let P = C * ((w.wBaseline ?? 0.05) + (w.wActivation ?? 0.45) * A + (w.wImportance ?? 0.35) * I + (w.wEmotion ?? 0.15) * E)
    P *= 1 + 0.25 * (Number(i.valence || 0) * mv)
    return { item: i, C, A, P }
  })
  const picked = scored.filter((x) => x.C >= minC).sort((a, b) => b.P - a.P).slice(0, top)
  for (const p of picked) {
    p.item.activation0 = clamp01((p.item.activation0 ?? 1) + (w.reinforce ?? 0.2) * (1 - (p.item.activation0 ?? 1)))
    p.item.activationAnchor = new Date().toISOString()
    p.item.hits = (p.item.hits ?? 1) + 1
  }
  if (picked.length) save(peerKey, db)
  return picked.map((p) => ({ ...p.item, _C: p.C, _P: p.P }))
}

const fmtDate = (iso) => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 记忆卡：注入系统提示（每条带时间；出处不是群友亲口说的会标出来） */
export function memoryCard(peerKey, cfg, query = '') {
  const top = cfg?.memory?.injectTop ?? 3
  const items = recall(peerKey, query, cfg, top)
  if (items.length === 0) return ''
  const header = '# 长期记忆（本会话，按相关度挑选；日期为事情发生/记下的时间）'
  const room = Math.max(80, Number(cfg?.memory?.injectChars ?? 300) || 300) - header.length
  const lines = []
  let used = 0
  for (const i of items) {
    const line = `- ${originTag(i.origin)}[${fmtDate(i.at)}] ${i.text}`
    if (used + line.length > room) break
    lines.push(line)
    used += line.length + 1
  }
  if (!lines.length) return ''
  return `${header}\n${lines.join('\n')}`
}

/** 注入时的出处前缀：群友亲口说的不加，别的加一句，免得把推断当事实说 */
function originTag(origin) {
  const o = normalizeOrigin(origin, '')
  if (o === 'agent') return '[本鱼记的]'
  if (o === 'web') return '[网上]'
  if (o === 'system') return '[系统]'
  return ''
}

export function listMemory(peerKey) {
  return load(peerKey).items.map((i) => ({
    id: i.id, text: i.text, category: i.category, at: i.at,
    importance: i.importance, emotion: i.emotion, hits: i.hits,
    pinned: !!i.pinned,
    origin: originOfItem(i),
    by: i.by ?? '',
    quote: i.quote ?? '',
    status: i.status ?? 'active',
    supersedes: i.supersedes ?? '',
    supersededBy: i.supersededBy ?? '',
    P: Number(scoreOf(i, '', {}, Date.now()).P.toFixed(3)),
    A: Number(freshness(i, {}, Date.now()).toFixed(3)),
  }))
}

/**
 * 改口：把记错的那条作废（不删，标 superseded 并指向新条），新条记成群友说的。
 * 注入口径只认 active，所以旧的不会和新的一起冒出来。
 * 找不到要改的那条就返回 ok:false，不硬写。
 */
export function correctMemory(peerKey, { id = '', keyword = '', text = '', by = '', quote = '', cfg = {} } = {}) {
  const clean = String(text ?? '').trim().slice(0, 600)
  if (clean.length < 2) return { ok: false, reason: '没有新的说法' }
  const db = load(peerKey)
  const kw = String(keyword || '').trim()
  const target = id
    ? db.items.find((i) => i.id === id)
    : kw
      ? db.items.find((i) => (i.status ?? 'active') !== 'superseded' && String(i.text).includes(kw))
      : null
  if (!target) return { ok: false, reason: '没找到要改的那条' }
  const added = addMemory(peerKey, {
    text: clean,
    category: target.category || 'fact',
    importance: Math.max(clamp01(target.importance), 0.7),
    origin: 'user',
    by,
    quote: quote || clean,
    supersedes: target.id,
  }, cfg)
  if (!added) return { ok: false, reason: '新说法没存进去' }
  const db2 = load(peerKey)
  const old = db2.items.find((i) => i.id === target.id)
  if (old) {
    old.status = 'superseded'
    old.supersededBy = added.id
    old.correctedAt = new Date().toISOString()
  }
  const fresh = db2.items.find((i) => i.id === added.id)
  if (fresh) {
    fresh.status = 'active'
    fresh.supersedes = target.id
  }
  save(peerKey, db2)
  try { audit('memory.correct', { peer: String(peerKey).slice(0, 16), oldId: target.id, newId: added.id }) } catch { /* ignore */ }
  return { ok: true, oldId: target.id, newId: added.id }
}

export function forgetMemory(peerKey, { id, keyword }) {
  const db = load(peerKey)
  const before = db.items.length
  if (id) db.items = db.items.filter((i) => i.id !== id)
  else if (keyword) db.items = db.items.filter((i) => !i.text.includes(keyword))
  save(peerKey, db)
  return before - db.items.length
}

export function pinMemory(peerKey, id, pinned = true) {
  const db = load(peerKey)
  const it = db.items.find((i) => i.id === id || i.text.includes(id))
  if (it) { it.pinned = pinned; save(peerKey, db) }
  return !!it
}

/** TTL 清理：太老且一直没被想起来的条目清掉（默认 180 天，0=不清理） */
export function prunePeer(peerKey, ttlDays = 180) {
  if (!ttlDays || ttlDays <= 0) return 0
  const db = load(peerKey)
  const now = Date.now()
  const before = db.items.length
  db.items = db.items.filter((i) => {
    if (i.pinned || i.category === 'stable_profile') return true
    const t = Date.parse(i.at ?? i.createdAt ?? '') || now
    const ageDays = (now - t) / DAY
    if (ageDays < ttlDays) return true
    return (i.activation0 ?? 1) > 0.2 && (i.hits ?? 1) > 2
  })
  if (db.items.length !== before) save(peerKey, db)
  return before - db.items.length
}

/** 召回悬挂：模型输出 [[recall: 词]] → 下一轮把结果补进系统提示 */
const pendingRecall = new Map()
export function queueRecall(peerKey, query) {
  pendingRecall.set(peerKey, String(query ?? '').trim().slice(0, 40))
}
export function takePendingRecall(peerKey) {
  const q = pendingRecall.get(peerKey)
  if (q === undefined) return null
  pendingRecall.delete(peerKey)
  return q
}
