/**
 * 她对每个人的「亲近度」——不是别人之间的关系，是她自己的偏好。
 *
 *   bond：熟不熟（-10 生疏 / 0 普通 / +10 很熟，可以损、可以开玩笑）
 *   trust：靠不靠谱（-10 爱耍她 / +10 说话算话）
 *
 * 更新时机：每轮聊天结束后按情绪信号微调（被夸 +，被怼 -，被无视 trust -）。
 * 用途：注入人设时给一句「对这个人可以怎么样」；也影响主动搭话的亲密度。
 */
import { readJson, writeJson, dirs } from './store.js'
import { join } from 'node:path'

const PATH = join(dirs.root, 'bond.json')
let cache = null

function load() {
  if (cache) return cache
  const j = readJson(PATH, null)
  cache = j && typeof j === 'object' ? j : { peers: {} }
  cache.peers ??= {}
  return cache
}

function save() { try { writeJson(PATH, cache) } catch { /* ignore */ } }

const clamp = (n) => Math.max(-10, Math.min(10, Number(n) || 0))

export function bondOf(peer, uid) {
  const b = load().peers[String(peer)]?.[String(uid)]
  return b ? { bond: Number(b.bond ?? 0), trust: Number(b.trust ?? 0), last: b.last ?? '', at: b.at ?? 0 } : { bond: 0, trust: 0, last: '', at: 0 }
}

/** 记一次互动：delta 可以是 {bond, trust, last} */
export function touchBond(peer, uid, delta = {}) {
  if (!peer || !uid) return null
  const p = load().peers
  const key = String(peer)
  p[key] ??= {}
  const cur = p[key][String(uid)] ?? { bond: 0, trust: 0, last: '', at: 0 }
  const next = {
    bond: clamp(cur.bond + Number(delta.bond ?? 0)),
    trust: clamp(cur.trust + Number(delta.trust ?? 0)),
    last: String(delta.last ?? cur.last ?? '').slice(0, 40),
    at: Date.now(),
  }
  p[key][String(uid)] = next
  save()
  return next
}

/** 从一条消息的情绪增量推断关系变化 */
export function bondFromDims(dims = {}) {
  const d = dims || {}
  let bond = 0
  let trust = 0
  if ((d.happy ?? 0) > 0 || (d.sweet ?? 0) > 0) bond += 0.3
  if ((d.pride ?? 0) > 0) bond += 0.2
  if ((d.anger ?? 0) > 0 || (d.sad ?? 0) > 0) bond -= 0.35
  if ((d.anger ?? 0) > 0) trust -= 0.3
  if ((d.heartache ?? 0) > 0 || (d.worry ?? 0) > 0) trust += 0.2
  return { bond, trust }
}

/** 一句话描述她对这个人的姿态（给提示词） */
export function bondHint(peer, uid, nick = '') {
  const b = bondOf(peer, uid)
  const who = nick || '这个人'
  if (b.bond >= 6) return '你和' + who + '很熟，可以损两句、开开玩笑，但别过界。'
  if (b.bond >= 2) return '你和' + who + '还算熟，语气可以随意点。'
  if (b.bond <= -4) return '你和' + who + '有点别扭，话别多、别主动贴上去。'
  if (b.trust <= -4) return '你不太信' + who + '（被耍过），别轻易答应他的事。'
  return ''
}
