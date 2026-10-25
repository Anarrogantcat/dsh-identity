/**
 * 学习：两件本地就能做的事（0 token）
 *
 * 1) 纠错学习：群里 Owner / 管理员说「不要…」「以后叫我…」「记住…」
 *    → 记成「本群规矩」，下一轮起注入人设；最多 20 条，重复自动合并
 * 2) 反馈学习：她说完，有没有人接？
 *    → 每个群维护 回应/发言 比例，得到 0.6~1.4 的倍率，乘进接话概率
 *
 * 只写 <store>/learned.json，不联网、不调模型。
 */
import { join } from 'node:path'
import { readJson, writeJson, dirs } from './store.js'

const PATH = join(dirs.root, 'learned.json')
const MAX_RULES = 20
const MAX_RULES_INJECT = 5
const REACT_WINDOW_MS = 3 * 60 * 1000
const STAT_CAP = 200

function fresh() {
  return { version: 1, rules: {}, stats: {} }
}

export function loadLearn() {
  const j = readJson(PATH, null)
  if (!j || typeof j !== 'object') return fresh()
  j.rules ??= {}
  j.stats ??= {}
  return j
}

export function saveLearn(db) {
  writeJson(PATH, db)
}

/** 从一句话里抽「可执行的规矩」；返回 null 表示这句不是在教规矩（纯函数，方便单测） */
export function extractRule(text) {
  const t = String(text ?? '').trim()
  if (!t || t.length > 120) return null
  let m = t.match(/(?:以后|今后|下次|往后)?\s*(?:不要|别再|别|不准|不许|禁止)\s*([^，。！？!?\n]{1,30})/)
  if (m) {
    const body = m[1].trim().replace(/^(再|老是|总是)/, '').trim()
    if (body.length >= 1) return '不要' + body
  }
  m = t.match(/(?:记住|记一下|记好)[：:，,]?\s*([^。！？!?\n]{2,40})/)
  if (m && m[1].trim().length >= 2) return '记住：' + m[1].trim()
  m = t.match(/(?:叫|称呼)我\s*([^，。！？!?\n]{1,12})/)
  if (m && m[1].trim()) return '叫我' + m[1].trim()
  return null
}

const ruleKey = (s) => String(s ?? '')
  .replace(/^不要/, '')
  .replace(/^(再|老是|总是)/, '')
  .replace(/^(记住|叫我)[：:]?/, '')
  .trim()

/** 记一条规矩；同一个意思再说一次会覆盖旧的 */
export function learnRule({ peerKey, text, by = '', source = 'chat' }) {
  const rule = String(text ?? '').trim()
  if (!rule) return { ok: false, error: '规矩是空的' }
  const db = loadLearn()
  const list = (db.rules[peerKey] ??= [])
  const key = ruleKey(rule)
  const hit = list.find((r) => ruleKey(r.text) === key)
  if (hit) {
    hit.text = rule
    hit.at = new Date().toISOString()
    hit.by = by
    saveLearn(db)
    return { ok: true, updated: true, rule }
  }
  list.push({ text: rule, by, source, at: new Date().toISOString() })
  while (list.length > MAX_RULES) list.shift()
  saveLearn(db)
  return { ok: true, rule }
}

export function rulesFor(peerKey, max = MAX_RULES_INJECT) {
  const list = loadLearn().rules[peerKey] ?? []
  return list.slice(-max).map((r) => r.text)
}

export function forgetRules(peerKey) {
  const db = loadLearn()
  const n = (db.rules[peerKey] ?? []).length
  delete db.rules[peerKey]
  saveLearn(db)
  return n
}

// ── 反馈学习：她说完有没有人接 ──

/** 她发了一句：返回「上一句是不是没人理」（给心情用） */
export function markSent(peerKey, at = Date.now()) {
  const db = loadLearn()
  const s = (db.stats[peerKey] ??= { sent: 0, reacted: 0, awaiting: 0 })
  const ignored = !!s.awaiting
  s.sent += 1
  s.awaiting = at
  if (s.sent > STAT_CAP) { s.sent = Math.round(s.sent / 2); s.reacted = Math.round(s.reacted / 2) }
  saveLearn(db)
  return ignored
}

/** 有人在她说完后接话 → 正反馈 */
export function markReacted(peerKey, at = Date.now()) {
  const db = loadLearn()
  const s = db.stats[peerKey]
  if (!s?.awaiting) return false
  if (at - s.awaiting > REACT_WINDOW_MS) { s.awaiting = 0; saveLearn(db); return false }
  s.reacted += 1
  s.awaiting = 0
  saveLearn(db)
  return true
}

export function replyRate(peerKey) {
  const s = loadLearn().stats[peerKey]
  if (!s || !s.sent) return { sent: 0, reacted: 0, rate: null }
  return { sent: s.sent, reacted: s.reacted, rate: Number((s.reacted / s.sent).toFixed(2)) }
}

/** 自适应倍率：样本不足给 1；回应率 0 → 0.6，50% → 1.0，100% → 1.4 */
export function adaptiveFactor(peerKey) {
  const { sent, rate } = replyRate(peerKey)
  if (sent < 10 || rate == null) return 1
  const f = 0.6 + Math.max(0, Math.min(1, rate)) * 0.8
  return Number(f.toFixed(2))
}

/** 面板/命令用：每个 peer 的规矩原文 + 反馈数据 */
export function learnView(maxRules = 5) {
  const db = loadLearn()
  const peers = new Set([...Object.keys(db.rules), ...Object.keys(db.stats)])
  return [...peers].map((k) => ({
    peerKey: k,
    rules: (db.rules[k] ?? []).slice(-maxRules).map((r) => r.text),
    ruleCount: (db.rules[k] ?? []).length,
    ...replyRate(k),
    factor: adaptiveFactor(k),
  }))
}

export function learnStats() {
  const db = loadLearn()
  const peers = new Set([...Object.keys(db.rules), ...Object.keys(db.stats)])
  return [...peers].map((k) => ({ peerKey: k, rules: (db.rules[k] ?? []).length, ...replyRate(k), factor: adaptiveFactor(k) }))
}
