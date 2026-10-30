/**
 * 身份决策账本：记录“接不接/为什么”，并在后续消息里记结果，喂给 traits。
 * 只存决策与结果，不改人格字段。
 */
import { join } from 'node:path'
import { readJson, writeJson, dirs, audit } from './store.js'
import { observe as traitObserve } from './traits.js'

const PATH = () => join(dirs.root, 'decisions.json')
const CAP = 500

function load() {
  const j = readJson(PATH(), null)
  if (!j || typeof j !== 'object') return { items: [] }
  return { items: Array.isArray(j.items) ? j.items : [] }
}
function save(db) {
  if (db.items.length > CAP) db.items = db.items.slice(-CAP)
  writeJson(PATH(), db)
}

export function record({ peer, sender, text, directed, reason, mood, bond }) {
  const db = load()
  const it = {
    id: 'd_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    at: new Date().toISOString(),
    peer: String(peer),
    sender: String(sender || ''),
    text: String(text || '').slice(0, 120),
    directed: !!directed,
    reason: String(reason || '').slice(0, 80),
    mood: String(mood || '').slice(0, 30),
    bond: Number.isFinite(Number(bond)) ? Number(bond) : null,
    repliedAt: '',
    outcome: '',
  }
  db.items.push(it)
  save(db)
  audit('identity.decision', { id: it.id, directed: it.directed, peer: it.peer.slice(0, 8) })
  return it
}

export function markReplied(peer) {
  const db = load()
  for (let i = db.items.length - 1; i >= 0; i--) {
    const it = db.items[i]
    if (it.peer !== String(peer)) continue
    if (!it.repliedAt) { it.repliedAt = new Date().toISOString(); save(db) }
    break
  }
}

export function noteInbound(peer, sender, text) {
  const db = load()
  const now = Date.now()
  let changed = false
  for (let i = db.items.length - 1; i >= 0; i--) {
    const it = db.items[i]
    if (it.peer !== String(peer) || it.outcome) continue
    const age = now - Date.parse(it.at || 0)
    if (age > 10 * 60000) break
    if (it.sender !== String(sender || '')) continue
    if (it.repliedAt) {
      it.outcome = 'engaged'
      try { traitObserve('接话后对方还会接着说，这说明这次接对了', { ref: 'decision:' + it.id, kind: 'decision' }) } catch { /* ignore */ }
      changed = true
    } else if (!it.directed && age < 5 * 60000 && /你|本鱼|鱼/.test(String(text || ''))) {
      it.outcome = 'missed_then_addressed'
      try { traitObserve('没接之后对方又来找，下次先看上下文再判断', { ref: 'decision:' + it.id, kind: 'decision' }) } catch { /* ignore */ }
      changed = true
    }
    break
  }
  if (changed) save(db)
  return changed
}

export function stats() {
  const items = load().items
  const last = items.slice(-20)
  return {
    total: items.length,
    directed: items.filter((x) => x.directed).length,
    replied: items.filter((x) => x.repliedAt).length,
    engaged: items.filter((x) => x.outcome === 'engaged').length,
    missed: items.filter((x) => x.outcome === 'missed_then_addressed').length,
    last: last.map((x) => ({ at: x.at, directed: x.directed, reason: x.reason, outcome: x.outcome })),
  }
}
