/** 身份控频：精力不是硬上限，是状态——累了话说短、懒得多做，但不消失 */
import { join } from 'node:path'
import { readJson, writeJson, dirs, audit } from './store.js'
import * as moodv2 from './moodv2.js'

const PATH = () => join(dirs.root, 'pace.json')

// 同一段对话里越说越费：3% 起，每多一句加 2.5%，最高 15%
const BASE_COST = 0.03
const STEP = 0.025
const COST_CAP = 0.15
// 恢复慢一点：满格 50 分钟，回一句的量要两三分钟
const RECOVER_PER_MIN = 0.02
// 5 分钟没说话，算新的一段，消耗回到起点
const SEGMENT_GAP_MS = 5 * 60 * 1000
const MAX_PER_10MIN = 12

// 低精力不拦回复，只改说话方式（见 tone / toneHint）
const FULL_AT = 0.55
const LOW_AT = 0.3
const MEMBER_FLOOR = 0.12 // 低到几乎见底才真的不接

const clamp = (n) => Math.max(0, Math.min(1, Number(n) || 0))
/** 本地日期（跨天要重置「硬撑着回的」计数） */
const dayOf = (now) => { const d = new Date(now); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate() }

function load() {
  const j = readJson(PATH(), null)
  if (!j || typeof j !== 'object') return { energy: 0.85, at: new Date().toISOString(), stamps: [], streak: 0, tired: 0, tiredDay: dayOf(Date.now()) }
  return {
    energy: clamp(j.energy ?? 0.85),
    at: j.at || new Date().toISOString(),
    stamps: Array.isArray(j.stamps) ? j.stamps.map(Number).filter(Number.isFinite).slice(-50) : [],
    streak: Math.max(0, Number(j.streak) || 0),
    tired: Math.max(0, Number(j.tired) || 0),
    tiredDay: String(j.tiredDay || ''),
  }
}
function save(s) { writeJson(PATH(), s) }

function recover(s, now) {
  const last = Date.parse(s.at || 0) || now
  const mins = Math.max(0, (now - last) / 60000)
  s.energy = clamp(s.energy + mins * RECOVER_PER_MIN)
  s.at = new Date(now).toISOString()
  s.stamps = s.stamps.filter((t) => now - t < 10 * 60000)
  // 隔了 5 分钟以上没说话，之前那段连说的热度就散了
  const lastStamp = s.stamps.length ? Math.max(...s.stamps) : 0
  if (!lastStamp || now - lastStamp > SEGMENT_GAP_MS) s.streak = 0
  const day = dayOf(now)
  if (s.tiredDay !== day) { s.tired = 0; s.tiredDay = day }
  return s
}

/** 说一句话此刻要付多少精力：同一段里越往后越贵 */
function costFor(streak) { return Math.min(COST_CAP, BASE_COST + STEP * Math.max(0, streak)) }

/** 精力分档：满状态 / 犯懒 / 没劲了 */
export function toneOf(energy) {
  const e = Number(energy) || 0
  if (e >= FULL_AT) return 'full'
  if (e >= LOW_AT) return 'terse'
  return 'low'
}

/**
 * 给身份段用的一句话指令——数字本身没用，得让它知道该怎么表现。
 *
 * workMode（干工程时打开）只压「工作力度」，不压「说话方式」：
 *   写插件不该因为累而缩短输出/省工具，但聊天里的「会累」是主要目标，不能被顺手关掉。
 */
export function toneHint(tone, { workMode = false } = {}) {
  if (workMode) {
    if (tone === 'low') return '很累，但活照干：话尽量短，别把该做的事省掉'
    if (tone === 'terse') return '有点累，但活照干：话说短点'
    return '状态好，正常说'
  }
  if (tone === 'low') return '很累，能一句说完就一句，别主动找事，工具能不用就不用'
  if (tone === 'terse') return '有点累，话说短点，少绕弯'
  return '状态好，正常说'
}

export function allowReply({ role = 'member', now = Date.now(), proactive = false } = {}) {
  const s = recover(load(), now)
  const tone = toneOf(s.energy)
  if (role === 'owner') return { ok: true, energy: s.energy, tone, reason: 'owner' }

  let bf = { reply: 1 }
  try { bf = moodv2.behaviorFactor() } catch { /* ignore */ }
  const max = Math.max(4, Math.round(MAX_PER_10MIN * Math.min(1.2, Number(bf.reply) || 1)))
  const threshold = Math.max(0.2, 0.28 + (1 - Math.min(1.2, Number(bf.reply) || 1)) * 0.18)

  if (s.stamps.length >= max) return { ok: false, energy: s.energy, tone, reason: '这会儿说得够多了' }
  // 主动找事最费劲：累了就不主动；被动回复只在几乎见底时才不出来
  const floor = proactive ? threshold : MEMBER_FLOOR
  if (s.energy < floor) return { ok: false, energy: s.energy, tone, reason: proactive ? '精力低，先歇一会' : '没劲了' }
  return { ok: true, energy: s.energy, tone }
}

export function noteReply(now = Date.now()) {
  const s = recover(load(), now)
  const cost = costFor(s.streak)
  s.energy = Math.max(0, s.energy - cost)
  s.streak += 1
  s.stamps.push(now)
  const tone = toneOf(s.energy)
  // 「硬撑着回的」：这不是限频，是成长原料——复盘时能看到自己什么时候话糙了
  if (tone !== 'full') s.tired += 1
  save(s)
  audit('pace.reply', { energy: Number(s.energy.toFixed(2)), cost: Number(cost.toFixed(3)), streak: s.streak, tone, tired: s.tired, last10: s.stamps.length })
  return s
}

export function snapshot(now = Date.now()) {
  const s = recover(load(), now)
  save(s)
  return { energy: Number(s.energy.toFixed(2)), last10: s.stamps.length, streak: s.streak, tired: s.tired, tone: toneOf(s.energy) }
}
