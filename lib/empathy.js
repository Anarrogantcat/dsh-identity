/** 共情事件：只记录、给温度，不强制套话 */
import { join } from 'node:path'
import { appendFileSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { dirs } from './store.js'
import { logInfo } from './diaglog.js'

const PATH = () => join(dirs.root, 'empathy.jsonl')
const RULES = [
  [/开心|高兴|好耶|爽|笑死|太好了|舒服/, '开心', 0.45],
  [/焦虑|紧张|慌|怕|担心|不安/, '焦虑', 0.55],
  [/难过|委屈|想哭|伤心|难受|失落/, '难过', 0.6],
  [/生气|烦|滚|气死|讨厌|恶心/, '生气', 0.55],
  [/累|困|疲惫|撑不住|没力气/, '疲惫', 0.5],
]
// 弱信号：没有明说的情绪，但人听了会觉得「他不对劲」。
// 只在跟有交情的人（bond>=2）之间算数，不然群里满地的「随便」「算了」会被当成难受。
const WEAK_RULES = [
  [/就这样吧|算了吧|算了[。！？!?]?$|无所谓|不想说|不说了|没意思|爱咋咋|随便吧|随便你/, '难过', 0.4],
]

export function detect(text) {
  const s = String(text || '')
  for (const [re, emotion, base] of RULES) {
    if (re.test(s)) {
      const hits = (s.match(re) || []).length
      return { emotion, intensity: Math.min(0.9, base + Math.min(0.2, hits * 0.05)), cause: s.slice(0, 60) }
    }
  }
  for (const [re, emotion, base] of WEAK_RULES) {
    if (re.test(s)) return { emotion, intensity: base, cause: s.slice(0, 60), weak: true }
  }
  return null
}

function strategyOf(emotion, intensity, bond = 0) {
  const deep = Number(intensity) >= (Number(bond) >= 2 ? 0.4 : 0.55)
  if (emotion === '开心') return deep ? '接住开心，顺一句细节' : '表示被感染到'
  if (emotion === '难过' || emotion === '焦虑') return deep ? '先听，别急着给建议' : '先确认听见了'
  if (emotion === '生气') return '先确认在气什么，别站队'
  if (emotion === '疲惫') return '给空间，别追问'
  return '正常接'
}

function guideOf(emotion, intensity, bond = 0) {
  const deep = Number(intensity) >= (Number(bond) >= 2 ? 0.4 : 0.55)
  if (emotion === '开心') return Number(bond) >= 2 ? (deep ? '深度陪伴：先接住开心，再顺着问一句细节。' : '熟人式：表示被感染到，可以损一句。') : '温和共情：表示一下被感染到就行。'
  if (emotion === '难过' || emotion === '焦虑') return deep ? '深度陪伴：先接住情绪，别急着给建议；可以问一句发生了什么。' : '温和共情：先表示听见了，别急着讲道理。'
  if (emotion === '生气') return '先确认在气什么，别站队、别拱火。'
  if (emotion === '疲惫') return '别追问，给一句轻的；让对方歇会儿。'
  return ''
}

export function record({ peer = '', who = '', text = '', emotion = '', intensity = 0, cause = '', bond = 0, weak = false }) {
  if (!emotion) return null
  const strategy = strategyOf(emotion, intensity, bond)
  const it = { at: new Date().toISOString(), peer: String(peer), who: String(who).slice(0, 20), emotion, intensity: Number(intensity.toFixed(2)), bond: Number(bond), strategy, cause: String(cause).slice(0, 60), guide: guideOf(emotion, intensity, bond), outcome: '', weak: !!weak }
  try { appendFileSync(PATH(), JSON.stringify(it) + '\n') } catch { /* ignore */ }
  // 也进运行日志：验收时不用翻 empathy.jsonl 才知道她到底听见没有
  try { logInfo('empathy.record', { peer: String(peer).slice(0, 10), emotion, intensity: it.intensity, bond: it.bond, weak: it.weak }) } catch { /* ignore */ }
  return it
}

export function recent(limit = 20) {
  try {
    if (!existsSync(PATH())) return []
    const lines = readFileSync(PATH(), 'utf8').trim().split('\n').slice(-Math.max(1, Number(limit) || 20))
    return lines.map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean).reverse()
  } catch { return [] }
}

export function latestFor(peer, withinMs = 10 * 60000) {
  try {
    const list = recent(50).filter((x) => String(x.peer) === String(peer))
    const hit = list[0]
    if (!hit) return null
    if (Date.now() - Date.parse(hit.at || 0) > withinMs) return null
    return hit
  } catch { return null }
}

/**
 * 注入用：最近一次共情。
 * 被明确拒绝过（「别安慰我」→ outcome=negative）就不再提——安慰被拒了还接着安慰，只会更烦。
 */
export function promptFor(peer, withinMs = 10 * 60000) {
  const ep = latestFor(peer, withinMs)
  if (!ep || !ep.guide) return null
  if (ep.outcome === 'negative') return null
  return ep
}

/** 下一条同群消息：给上一条共情记结果，不猜太多 */export function noteOutcome(peer, text = '', now = Date.now()) {
  try {
    if (!existsSync(PATH())) return false
    const lines = readFileSync(PATH(), 'utf8').trim().split('\n')
    for (let i = lines.length - 1; i >= 0; i--) {
      let it = null
      try { it = JSON.parse(lines[i]) } catch { continue }
      if (String(it.peer) !== String(peer) || it.outcome) continue
      if (now - Date.parse(it.at || 0) > 10 * 60000) break
      it.outcome = /别这样|不用|烦|闭嘴|别共情|别安慰/.test(String(text)) ? 'negative' : 'continued'
      lines[i] = JSON.stringify(it)
      writeFileSync(PATH(), lines.join('\n') + '\n', 'utf8')
      return true
    }
  } catch { /* ignore */ }
  return false
}
