/**
 * 自我卡 + 待办卡 + 认知汇总
 *
 * 自我卡：<store>/self/<peerKey>.json   { self: [{ text, at, kind: 'say'|'promise' }] }
 * 待办卡：<store>/todos/<peerKey>.json  { items: [{ id, sender, name, text, at, consumed }] }
 *
 * 只存摘出来的句子，不存整段聊天；每张卡都很短（合起来 ≤600 字）。
 */
import { join } from 'node:path'
import { readJson, writeJson, dirs, sha } from './store.js'
import { presenceCard } from './relations.js'

const SELF_CAP = 20
const MISSED_CAP = 10

// 自述/承诺：含这些词的句子才有价值；承诺额外用下面的词判定
const SELF_RE = /我|答应|回头|明天|帮你|记得/
const PROMISE_RE = /答应|回头|明天|后天|晚点|待会|待会儿|稍后|一会儿|马上|以后|帮你|记得|补上/

function toIso(v) {
  if (v === undefined || v === null || v === '') return new Date().toISOString()
  if (typeof v === 'number') return new Date(v).toISOString()
  const t = Date.parse(String(v))
  return Number.isFinite(t) ? new Date(t).toISOString() : new Date().toISOString()
}

function sentences(text) {
  return String(text ?? '')
    .split(/[。！？!?；;\n…]+/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

function selfPath(peerKey) {
  return join(dirs.root, 'self', `${String(peerKey)}.json`)
}
function todosPath(peerKey) {
  return join(dirs.root, 'todos', `${String(peerKey)}.json`)
}

function loadSelf(peerKey) {
  const j = readJson(selfPath(peerKey), null)
  if (!j || typeof j !== 'object' || Array.isArray(j)) return { self: [] }
  return { self: Array.isArray(j.self) ? j.self.filter((x) => x && typeof x.text === 'string') : [] }
}
function saveSelf(peerKey, db) {
  try { writeJson(selfPath(peerKey), db) } catch { /* ignore */ }
}
function loadTodos(peerKey) {
  const j = readJson(todosPath(peerKey), null)
  if (!j || typeof j !== 'object' || Array.isArray(j)) return { items: [] }
  return {
    items: Array.isArray(j.items)
      ? j.items.filter((x) => x && typeof x.text === 'string' && x.text.trim())
      : [],
  }
}
function saveTodos(peerKey, db) {
  try { writeJson(todosPath(peerKey), db) } catch { /* ignore */ }
}

/** 从她发出的文本里抽「自述/承诺」：最多留 20 条 */
export function noteSelf(peerKey, text) {
  if (!peerKey) return []
  const db = loadSelf(peerKey)
  const added = []
  for (const s of sentences(text)) {
    if (!SELF_RE.test(s)) continue
    const clean = s.slice(0, 60)
    const kind = PROMISE_RE.test(clean) ? 'promise' : 'say'
    // 同一句重复说 → 只更新时间，不重复占坑
    const old = db.self.findIndex((x) => x.text === clean)
    if (old >= 0) db.self.splice(old, 1)
    const item = { text: clean, at: new Date().toISOString(), kind }
    db.self.push(item)
    added.push({ ...item })
  }
  if (added.length) {
    if (db.self.length > SELF_CAP) db.self = db.self.slice(-SELF_CAP)
    saveSelf(peerKey, db)
  }
  return added
}

/** 自我卡：说过什么 / 答应过什么（都没有就返回空串） */
export function selfCard(peerKey) {
  const db = loadSelf(peerKey)
  const says = db.self.filter((x) => x.kind !== 'promise').slice(-3).map((x) => x.text)
  const proms = db.self.filter((x) => x.kind === 'promise').slice(-3).map((x) => x.text)
  if (!says.length && !proms.length) return ''
  const lines = ['# 我刚才说过/答应过']
  if (says.length) lines.push(`说过：${says.join('；')}`)
  if (proms.length) lines.push(`答应过：${proms.join('；')}`)
  return lines.join('\n')
}

/** 记录被闸门挡掉但叫到她的消息（最多 10 条） */
export function noteMissed(peerKey, msg = {}) {
  if (!peerKey) return null
  const text = String(msg.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 80)
  if (!text) return null
  const at = toIso(msg.at)
  const db = loadTodos(peerKey)
  const now = Date.parse(at) || Date.now()
  // 同一句话 2 分钟内重复只算一次
  const dup = db.items.find((x) => x.text === text && !x.consumed && Math.abs((Date.parse(x.at) || 0) - now) < 120000)
  if (dup) return { ...dup }
  const item = {
    id: sha(`${peerKey}:${text}:${at}`, 12),
    sender: String(msg.sender ?? ''),
    name: String(msg.name ?? '').slice(0, 32),
    text,
    at,
    reason: String(msg.reason ?? '当时在冷却没回').slice(0, 24),
    consumed: false,
  }
  db.items.push(item)
  if (db.items.length > MISSED_CAP) db.items = db.items.slice(-MISSED_CAP)
  saveTodos(peerKey, db)
  return { ...item }
}

function pendingTodos(peerKey, maxAgeMin) {
  const db = loadTodos(peerKey)
  const now = Date.now()
  const limit = Math.max(1, Number(maxAgeMin) || 30) * 60000
  return db.items
    .filter((it) => !it.consumed)
    .map((it) => ({ it, ageMin: Math.round((now - (Date.parse(it.at) || now)) / 60000) }))
    .filter((x) => x.ageMin <= Math.max(1, Number(maxAgeMin) || 30))
    .filter((x) => (Date.parse(x.it.at) || 0) > 0 && now - (Date.parse(x.it.at) || 0) <= limit)
}

/** 取出还没补答且未过期的（取完标记 consumed，不会重复返回） */
export function takeTodos(peerKey, maxAgeMin = 30) {
  const db = loadTodos(peerKey)
  const now = Date.now()
  const limit = Math.max(1, Number(maxAgeMin) || 30) * 60000
  const keep = []
  const got = []
  for (const it of db.items) {
    const t = Date.parse(it.at ?? '') || 0
    if (!t || now - t > limit) continue // 过期直接丢
    if (it.consumed) { keep.push(it); continue }
    it.consumed = true
    it.consumedAt = new Date(now).toISOString()
    keep.push(it)
    got.push({ ...it, ageMin: Math.round((now - t) / 60000) })
  }
  if (got.length) {
    db.items = keep.slice(-MISSED_CAP * 2)
    saveTodos(peerKey, db)
  }
  return got
}

const ageText = (min) => {
  const m = Math.max(0, Math.round(Number(min) || 0))
  if (m < 1) return '刚刚'
  if (m < 60) return `${m} 分钟前`
  return `${Math.round(m / 60)} 小时前`
}

/** 待办卡：没答完的问题（不消耗） */
export function todoCard(peerKey, maxAgeMin = 30) {
  const list = pendingTodos(peerKey, maxAgeMin).slice(-3)
  if (!list.length) return ''
  const lines = list.map(({ it, ageMin }) => `${ageText(ageMin)}「${it.text}」——${it.reason || '当时在冷却没回'}`)
  return `# 还没答完的\n${lines.join('\n')}`
}

/** 认知汇总：人物卡 + 自我卡 + 待办卡（空卡跳过，总长 ≤600 字） */
export function cognitiveBlock(peerKey, cfg) {
  const chars = Math.min(1200, Math.max(60, Number(cfg?.cognition?.blockChars) || 600))
  const parts = [
    presenceCard(peerKey, cfg?.cognition?.presenceTop ?? 5),
    selfCard(peerKey),
    todoCard(peerKey, cfg?.cognition?.todoMaxAgeMin ?? 30),
  ].filter((s) => typeof s === 'string' && s.trim())
  if (!parts.length) return ''
  const out = parts.join('\n\n')
  const cps = [...out]
  return cps.length > chars ? cps.slice(0, chars).join('') : out
}
