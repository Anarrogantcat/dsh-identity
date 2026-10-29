/**
 * 在场感：从事实流里读「群里现在什么气氛」，不是规则开关。
 * 只读 events，不调模型；输出一句给上下文用。
 */
import { readEvents } from './events.js'
import { dayStr } from './diary.js'

const MIN = 60 * 1000

export function atmosphereOf(peerKey, nameOf) {
  try {
    const evs = readEvents(String(peerKey), dayStr()).filter((e) => e.kind === 'talk')
    if (!evs.length) return ''
    const now = Date.now()
    const last = evs[evs.length - 1]
    const ageMin = Math.max(0, Math.round((now - Date.parse(last.at || 0)) / MIN))
    const recent = evs.filter((e) => now - Date.parse(e.at || 0) < 15 * MIN && e.origin === 'inbound')
    const who = [...new Set(recent.map((e) => (typeof nameOf === 'function' ? nameOf(String(e.who || '')) : String(e.who || '')).slice(0, 10)).filter(Boolean))].slice(0, 4)
    const mine = evs.filter((e) => e.origin === 'bot')
    const lastMine = mine[mine.length - 1]
    const mineAge = lastMine ? Math.max(0, Math.round((now - Date.parse(lastMine.at || 0)) / MIN)) : -1
    const parts = []
    if (ageMin <= 2) parts.push('群里刚还在说话')
    else if (ageMin <= 20) parts.push('上一条是 ' + ageMin + ' 分钟前')
    else parts.push('群里安静了 ' + (ageMin >= 60 ? Math.round(ageMin / 60) + ' 小时' : ageMin + ' 分钟'))
    if (who.length) parts.push('最近说话的是 ' + who.join('、'))
    if (mineAge >= 0) parts.push('你上次开口在 ' + (mineAge >= 60 ? Math.round(mineAge / 60) + ' 小时前' : mineAge + ' 分钟前'))
    return parts.join('；')
  } catch { return '' }
}

/** 她离开这段时间，群里发生了什么（给「续上」用） */
export function sinceLastSpoke(peerKey, maxChars = 100) {
  try {
    const evs = readEvents(String(peerKey), dayStr()).filter((e) => e.kind === 'talk')
    const mine = evs.filter((e) => e.origin === 'bot')
    if (!mine.length) return ''
    const at = Date.parse(mine[mine.length - 1].at || 0)
    const after = evs.filter((e) => Date.parse(e.at || 0) > at && e.origin === 'inbound')
    if (!after.length) return ''
    return after.slice(-3).map((e) => String(e.text || '').slice(0, 40)).join(' / ').slice(0, maxChars)
  } catch { return '' }
}
