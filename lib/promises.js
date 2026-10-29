/**
 * 承诺（L2）：答应 → 待办 → 兑现/逾期 → 进接续包与反思。
 *
 * 规则：
 *   · 只从「她真的说出口的话」里抓（origin=bot 的 talk），不从群友的话里抓
 *   · 幂等：同一句话只记一条（ref=promise:<sha>）
 *   · 状态：open → done / dropped；逾期（默认 2 天）由反思统计，不自动删
 *   · 接续包必须带未完成承诺；模型不能自己把承诺标成 done（#兑现 由 Owner）
 */
import { join } from 'node:path'
import { readJson, writeJson, dirs, sha, audit } from './store.js'

const PATH = () => join(dirs.root, 'promises.json')
const DAY = 86400000
export const PROMISE_RE = /(答应|回头|明天|等下|一会儿|帮你|记得|我想想|稍后|待会)/

function load() {
  const j = readJson(PATH(), null)
  if (!j || typeof j !== 'object' || !Array.isArray(j.items)) return { version: 1, items: [] }
  return j
}
function save(db) { writeJson(PATH(), db) }

/** 从她的一句话里抽承诺（gating 在调用方：只对 origin=bot 用） */
export function notePromise(peerKey, text, { at, ref, global = false } = {}) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 80)
  if (!s || !PROMISE_RE.test(s)) return { ok: false, skipped: true }
  const db = load()
  const id = 'p_' + sha(String(peerKey) + '|' + s, 10)
  if (db.items.some((x) => x.id === id)) return { ok: true, dup: true, id }
  const rec = {
    id,
    peerKey: String(peerKey),
    text: s,
    at: at ? new Date(at).toISOString() : new Date().toISOString(),
    ref: ref ? String(ref).slice(0, 80) : '',
    status: 'open',
    global: !!global,
  }
  db.items.push(rec)
  if (db.items.length > 300) db.items = db.items.slice(-300)
  save(db)
  audit('promise.add', { id, peer: String(peerKey).slice(0, 16) })
  return { ok: true, id, rec }
}

export function listPromises({ status = '', peerKey = '' } = {}) {
  const db = load()
  const now = Date.now()
  return db.items
    .filter((x) => (!status || x.status === status) && (!peerKey || x.peerKey === peerKey))
    .map((x) => ({ ...x, ageDays: Number(((now - Date.parse(x.at ?? 0)) / DAY).toFixed(1)), overdue: x.status === 'open' && now - Date.parse(x.at ?? 0) > 2 * DAY }))
    .sort((a, b) => (b.overdue ? 1 : 0) - (a.overdue ? 1 : 0) || Date.parse(b.at ?? 0) - Date.parse(a.at ?? 0))
}

/** Owner 兑现/放弃；只影响状态，不改原文 */
export function closePromise(id, how = 'done') {
  const db = load()
  const it = db.items.find((x) => x.id === String(id))
  if (!it) return { ok: false, error: '没有这条承诺' }
  it.status = how === 'dropped' ? 'dropped' : 'done'
  it.closedAt = new Date().toISOString()
  save(db)
  audit('promise.close', { id: it.id, how: it.status })
  try { moodEvent(it.status === 'done' ? 'promise_kept' : 'promise_broken') } catch { /* ignore */ }
  return { ok: true, item: it }
}

/** 接续包用：未完成承诺（最多 3 条短句） */
export function openPromiseLines(peerKey, limit = 3) {
  const local = listPromises({ status: 'open', peerKey })
  const all = listPromises({ status: 'open' }).filter((x) => x.global && x.peerKey !== peerKey)
  return [...local, ...all]
    .sort((a, b) => (b.overdue ? 1 : 0) - (a.overdue ? 1 : 0) || Date.parse(b.at) - Date.parse(a.at))
    .slice(0, Math.max(1, limit))
    .map((x) => (x.overdue ? '· [逾期] ' : '· ') + x.text)
}

/** 反思用：逾期条目 */
export function overduePromises(peerKey = '') {
  return listPromises({ status: 'open', peerKey }).filter((x) => x.overdue)
}
