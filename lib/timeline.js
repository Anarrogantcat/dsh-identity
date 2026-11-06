/**
 * 时间线回忆：从事实流里取「某个人最近的原话」，补充摘要记忆缺少的细节。
 * 只读 events，不新增存储；失败返回空数组。
 */
import { readEvents } from './events.js'
import { dayStr } from './diary.js'

/** @returns {string[]} 最近几天里这个人的原话（短句，去重） */
export function recentRaw(peerKey, who, { days = 3, limit = 2, maxChars = 60 } = {}) {
  try {
    const target = String(who || '').trim()
    if (!target) return []
    const out = []
    const seen = new Set()
    for (let i = 0; i < Math.max(1, days); i++) {
      const d = new Date(Date.now() - i * 86400000)
      const evs = readEvents(String(peerKey), dayStr(d)).filter((e) => e.kind === 'talk' && e.origin === 'inbound')
      for (const e of evs) {
        if (String(e.who || '').trim() !== target) continue
        const t = String(e.text || '').replace(/\s+/g, ' ').trim().slice(0, maxChars)
        if (t.length < 3 || seen.has(t)) continue
        seen.add(t)
        out.push(t)
      }
    }
    return out.slice(-Math.max(1, limit))
  } catch { return [] }
}

/** 群级最近消息（今天优先，不够回溯 1 天）：给话题卡用 @returns {{nick:string,text:string,at:number}[]} */
export function recentGroup(peerKey, { limit = 8, maxChars = 60, resolveNick = null } = {}) {
  try {
    const out = []
    for (let i = 0; i < 2; i++) {
      const d = new Date(Date.now() - i * 86400000)
      const evs = readEvents(String(peerKey), dayStr(d)).filter((e) => e.kind === 'talk' && e.origin === 'inbound')
      for (const e of evs) {
        const text = String(e.text || '').replace(/\s+/g, ' ').trim().slice(0, maxChars)
        if (text.length < 2) continue
        const uid = String(e.who || '').trim()
        let nick = uid || '有人'
        try { const n = resolveNick ? resolveNick(uid) : ''; if (n) nick = String(n) } catch { /* ignore */ }
        out.push({ nick, text, at: Number(e.at ?? 0) })
      }
    }
    return out.slice(-Math.max(1, limit))
  } catch { return [] }
}
