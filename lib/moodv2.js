/**
 * 心情 v2（L2）：七情 + 六欲 + 复合情绪。
 *
 * 铁律：心情只改「怎么说」，不改事实、边界、收费、安全规则。
 *   · 七情：喜 joy / 怒 anger / 哀 sorrow / 惧 fear / 爱 love / 恶 disgust / 欲 desire
 *   · 六欲：饭 belly / 安全 safety / 归属 belonging / 尊重 respect / 好奇 curiosity / 亲近 intimacy
 *   · 复合：别扭（爱+怒）、得意（喜+被尊重）、忐忑（惧+好奇）、委屈（哀+缺归属）、抗拒（恶/怒高）
 *   · 纯本地关键词打分（0 token），随时间往基线衰减；LLM 评估以后只做增量，不直接改行为
 */
import { join } from 'node:path'
import { readJson, writeJson, dirs, audit } from './store.js'

const PATH = () => join(dirs.root, 'mood-v2.json')
const BASE = 0.3
const HOUR = 3600000
const HALF = 12 // 12 小时没新信号就衰减一半

export const SEVEN = ['joy', 'anger', 'sorrow', 'fear', 'love', 'disgust', 'desire']
export const NEEDS = ['belly', 'safety', 'belonging', 'respect', 'curiosity', 'intimacy']

const SIG = [
  [/(哈+|哈哈|笑死|好耶|棒|厉害|可爱|喜欢|谢谢)/, { joy: 0.12, love: 0.06, respect: 0.05 }],
  [/(滚|傻|笨|蠢|烦|闭嘴|讨厌|恶心)/, { anger: 0.16, disgust: 0.08, respect: -0.05 }],
  [/(难过|委屈|想哭|唉|难受|伤心)/, { sorrow: 0.14, belonging: -0.05 }],
  [/(怕|吓|危险|慌|紧张)/, { fear: 0.12, safety: -0.1 }],
  [/(爱你|抱抱|贴贴|亲亲|想你)/, { love: 0.16, intimacy: 0.12, belonging: 0.08 }],
  [/(恶心|吐了|膈应|太脏)/, { disgust: 0.14 }],
  [/(饿|白饭|饭|吃|宵夜|夜宵)/, { desire: 0.1, belly: 0.12 }],
  [/(为什么|怎么|是什么|求问|好奇|真的吗|居然)/, { curiosity: 0.1 }],
  [/(夸|牛|强|专业|靠谱|记得你)/, { respect: 0.12, joy: 0.06 }],
  [/(一起|群里|你们|大家|回来|在吗)/, { belonging: 0.06 }],
  [/(滚出去|别理你|孤立|退群)/, { anger: 0.14, belonging: -0.12 }],
]

const clamp = (n) => Math.min(1, Math.max(0, Number(n) || 0))

function fresh() {
  const seven = Object.fromEntries(SEVEN.map((k) => [k, BASE]))
  const needs = Object.fromEntries(NEEDS.map((k) => [k, BASE]))
  return { version: 1, seven, needs, at: new Date().toISOString(), lastBy: '', lastKind: '', events: 0 }
}

function load() {
  const j = readJson(PATH(), null)
  if (!j || typeof j !== 'object' || !j.seven || !j.needs) return fresh()
  return {
    version: 1,
    seven: { ...Object.fromEntries(SEVEN.map((k) => [k, BASE])), ...Object.fromEntries(SEVEN.map((k) => [k, clamp(j.seven[k])])) },
    needs: { ...Object.fromEntries(NEEDS.map((k) => [k, BASE])), ...Object.fromEntries(NEEDS.map((k) => [k, clamp(j.needs[k])])) },
    at: j.at ?? new Date().toISOString(),
    lastBy: String(j.lastBy ?? ''),
    lastKind: String(j.lastKind ?? ''),
    events: Number(j.events ?? 0),
  }
}

function save(s) { writeJson(PATH(), s) }

/** 衰减：距上次信号越久越靠近基线 */
export function decayOf(state, now = Date.now()) {
  const s = { ...state, seven: { ...state.seven }, needs: { ...state.needs } }
  const hours = Math.max(0, (now - (Date.parse(state.at) || now)) / HOUR)
  if (!hours) return s
  const k = Math.pow(0.5, hours / HALF)
  for (const key of SEVEN) s.seven[key] = clamp(BASE + (s.seven[key] - BASE) * k)
  for (const key of NEEDS) s.needs[key] = clamp(BASE + (s.needs[key] - BASE) * k)
  s.at = new Date(now).toISOString()
  return s
}

export function getState(now = Date.now()) { return decayOf(load(), now) }

/**
 * 吃一条群消息（只读信号，不据此回复/收费）。
 * @returns {{ok:boolean, state?:object, changed?:string[]}}
 */
export function note(text, { role = 'member', kind = 'text', now = Date.now() } = {}) {
  const s = getState(now)
  const t = String(text ?? '')
  if (!t.trim()) return { ok: false }
  const changed = []
  for (const [re, delta] of SIG) {
    if (!re.test(t)) continue
    for (const [k, v] of Object.entries(delta)) {
      const target = k in s.seven ? s.seven : k in s.needs ? s.needs : null
      if (!target) continue
      target[k] = clamp((target[k] ?? BASE) + v * (role === 'owner' ? 1.2 : 1))
      changed.push(k)
    }
  }
  if (role === 'owner') { s.needs.belonging = clamp(s.needs.belonging + 0.02); s.needs.intimacy = clamp(s.needs.intimacy + 0.02) }
  s.lastBy = String(role)
  s.lastKind = String(kind)
  s.events += 1
  s.at = new Date(now).toISOString()
  save(s)
  return { ok: true, state: s, changed: [...new Set(changed)] }
}

/** 复合情绪：返回 [{id, label}]，最多 2 个 */
export function blendsOf(state) {
  const { seven: e, needs: n } = state
  const out = []
  if (e.love > 0.5 && e.anger > 0.3) out.push({ id: 'awkward', label: '别扭' })
  if (e.joy > 0.6 && n.respect > 0.5) out.push({ id: 'smug', label: '得意' })
  if (e.fear > 0.4 && n.curiosity > 0.5) out.push({ id: 'uneasy', label: '忐忑' })
  if (e.sorrow > 0.5 && n.belonging < 0.4) out.push({ id: 'wronged', label: '委屈' })
  if (e.disgust > 0.5 || e.anger > 0.65) out.push({ id: 'resist', label: '抗拒' })
  return out.slice(0, 2)
}

const TONE = {
  别扭: '嘴上别承认，先嘴硬一句再照办；句子短、有点酸。',
  得意: '语气轻快，可以小得瑟一句，别过头。',
  忐忑: '话少一点、试探着说，别急着下结论。',
  委屈: '短句、低音量，不撒娇、不诉苦。',
  抗拒: '不接梗、不卖萌；该顶就顶一句，但别骂人。',
}

/** 注入块：只给语气，≤chars 字（默认 140） */
export function toneBlock(state, { chars = 140 } = {}) {
  const b = blendsOf(state)
  if (!b.length) return ''
  const lines = ['# 这会儿的心情（只影响怎么说，不改事实与边界）']
  for (const x of b) lines.push(`${x.label}：${TONE[x.label] ?? ''}`)
  let text = lines.join('\n')
  if (text.length > chars) text = text.slice(0, chars - 1) + '…'
  return text
}

/** 面板摘要 */
export function summary(state = getState()) {
  const top = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1])[0]
  return {
    seven: state.seven,
    needs: state.needs,
    topSeven: top(state.seven),
    topNeed: top(state.needs),
    blends: blendsOf(state).map((x) => x.label),
    at: state.at,
    events: state.events,
  }
}

export function reset() {
  save(fresh())
  audit('mood.v2.reset', {})
  return { ok: true }
}
