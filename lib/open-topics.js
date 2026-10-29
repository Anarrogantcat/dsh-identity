/**
 * 没聊完的话题：持久化，隔一阵由她自己决定要不要追问。
 * 只存一句短摘要，不存原话；7 天过期；每群最多 8 条。
 */
import { readJson, writeJson, dirs } from './store.js'
import { join } from 'node:path'

const PATH = () => join(dirs.root, 'open-topics.json')
const TTL = 7 * 86400000

function load() {
  try { const d = readJson(PATH(), null); if (d && typeof d === 'object') return d } catch { /* ignore */ }
  return { peers: {} }
}
function save(d) { try { writeJson(PATH(), d) } catch { /* ignore */ } }

export function noteOpen(peerKey, text, at = Date.now()) {
  const t = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 80)
  if (peerKey == null || t.length < 6) return { ok: false }
  const db = load()
  const arr = (db.peers[String(peerKey)] ??= [])
  const now = at
  const fresh = arr.filter((x) => x && now - Number(x.at || 0) < TTL)
  if (fresh.some((x) => now - Number(x.at || 0) < 3600000 && x.text === t)) return { ok: false, dup: true }
  fresh.push({ id: 'o_' + Math.random().toString(36).slice(2, 8), text: t, at: now, asked: false })
  db.peers[String(peerKey)] = fresh.slice(-8)
  save(db)
  return { ok: true }
}

/** 找一条还没追问、已经放了至少 hours 小时的话题；不标记已问 */
export function dueOpen(peerKey, hours = 20, now = Date.now()) {
  const arr = load().peers[String(peerKey)] || []
  const hit = arr.find((x) => x && !x.asked && now - Number(x.at || 0) >= hours * 3600000)
  return hit ? { id: hit.id, text: hit.text, at: hit.at } : null
}

/** 追问过就标记，避免反复问同一件事 */
export function markAsked(peerKey, id) {
  const db = load()
  const arr = db.peers[String(peerKey)] || []
  for (const x of arr) if (x && x.id === id) x.asked = true
  save(db)
  return { ok: true }
}

export function prune(now = Date.now()) {
  const db = load()
  let removed = 0
  for (const k of Object.keys(db.peers)) {
    const before = db.peers[k].length
    db.peers[k] = db.peers[k].filter((x) => x && now - Number(x.at || 0) < TTL)
    removed += before - db.peers[k].length
    if (!db.peers[k].length) delete db.peers[k]
  }
  if (removed) save(db)
  return removed
}
