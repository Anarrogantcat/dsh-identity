/**
 * web / 非 QQ 会话的成长入口：接宿主 ctx.on('session/event')。
 * 只处理没有被通道适配器认领的会话（QQ 由 gate 自己记录），避免重复。
 */
import { appendEvent } from './events.js'
import { resolveSession } from './channel.js'
import { addMemory } from './memory.js'
import { redactForMemory } from './privacy.js'
import { audit } from './store.js'

function textOf(v, depth = 0) {
  if (depth > 5 || v == null) return ''
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return v.map((x) => textOf(x, depth + 1)).filter(Boolean).join(' ')
  if (typeof v === 'object') {
    if (typeof v.text === 'string' && v.type !== 'tool') return v.text
    if (v.content) return textOf(v.content, depth + 1)
    if (v.message) return textOf(v.message, depth + 1)
    if (v.data) return textOf(v.data, depth + 1)
  }
  return ''
}

export function installSessionGrowth(ctx, { getConfig, logger = console } = {}) {
  if (!ctx || typeof ctx.on !== 'function') return false
  try {
    ctx.on('session/event', (session, event) => {
      try {
        const sid = String(session?.header?.id ?? session?.id ?? '')
        if (!sid) return
        if (resolveSession(sid)) return // QQ 等已认领的会话不重复记
        const type = String(event?.type ?? '')
        if (type !== 'user/message' && type !== 'assistant/message') return
        // 两种消息的形状不一样：user/message 的 data 本身就是消息（role+content），
        // assistant/message 才包在 data.message 里。以前只取 data.message，
        // 结果用户消息永远 text 为空被丢掉——web 会话的记忆一直是空的。
        const raw = event?.data?.message ?? event?.message ?? (type === 'user/message' ? event?.data : null) ?? event?.content
        const text = textOf(raw).replace(/\s+/g, ' ').trim().slice(0, 300)
        if (!text) return
        const origin = type === 'assistant/message' ? 'bot' : 'inbound'
        const pk = 'web_' + sid
        const ref = sid + ':' + String(event?.seq ?? event?.id ?? event?.data?.turn ?? Date.now())
        const cfg = getConfig?.() ?? {}
        appendEvent(pk, { kind: 'talk', origin, text: redactForMemory(text, cfg), ref })
        if (origin === 'inbound' && cfg.memory?.enabled) {
          try { addMemory(pk, { text: redactForMemory(text, cfg), category: 'event', importance: 0.3, source: 'web', origin: 'user' }, cfg) } catch { /* ignore */ }
        }
        try { audit('web.growth', { sid: sid.slice(0, 8), origin, len: text.length }) } catch { /* ignore */ }
      } catch (err) {
        logger.warn?.('[identity] session growth failed: ' + (err?.message ?? err))
      }
    })
    return true
  } catch { return false }
}
