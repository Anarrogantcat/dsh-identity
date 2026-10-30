/** 身份控频：回复消耗精力，恢复需要时间；不是规则硬上限 */
import { join } from 'node:path'
import { readJson, writeJson, dirs, audit } from './store.js'
import * as moodv2 from './moodv2.js'

const PATH = () => join(dirs.root, 'pace.json')
const COST = 0.035
const RECOVER_PER_MIN = 0.05
const MAX_PER_10MIN = 12

function load() {
  const j = readJson(PATH(), null)
  if (!j || typeof j !== 'object') return { energy: 0.85, at: new Date().toISOString(), stamps: [] }
  return { energy: Math.max(0, Math.min(1, Number(j.energy ?? 0.85))), at: j.at || new Date().toISOString(), stamps: Array.isArray(j.stamps) ? j.stamps.slice(-50) : [] }
}
function save(s) { writeJson(PATH(), s) }
function recover(s, now) {
  const last = Date.parse(s.at || 0) || now
  const mins = Math.max(0, (now - last) / 60000)
  s.energy = Math.min(1, s.energy + mins * RECOVER_PER_MIN)
  s.at = new Date(now).toISOString()
  s.stamps = s.stamps.filter((t) => now - Number(t) < 10 * 60000)
  return s
}

export function allowReply({ role = 'member', now = Date.now() } = {}) {
  const s = recover(load(), now)
  if (role === 'owner') return { ok: true, energy: s.energy, reason: 'owner' }
  let bf = { reply: 1 }
  try { bf = moodv2.behaviorFactor() } catch { /* ignore */ }
  const max = Math.max(4, Math.round(MAX_PER_10MIN * Math.min(1.2, Number(bf.reply) || 1)))
  const threshold = Math.max(0.2, 0.28 + (1 - Math.min(1.2, Number(bf.reply) || 1)) * 0.18)
  if (s.stamps.length >= max) return { ok: false, energy: s.energy, reason: '这会儿说得够多了' }
  if (s.energy < threshold) return { ok: false, energy: s.energy, reason: '精力低，先歇一会' }
  return { ok: true, energy: s.energy }
}

export function noteReply(now = Date.now()) {
  const s = recover(load(), now)
  s.energy = Math.max(0, s.energy - COST)
  s.stamps.push(now)
  save(s)
  audit('pace.reply', { energy: Number(s.energy.toFixed(2)), last10: s.stamps.length })
  return s
}

export function snapshot(now = Date.now()) { const s = recover(load(), now); save(s); return { energy: Number(s.energy.toFixed(2)), last10: s.stamps.length } }
