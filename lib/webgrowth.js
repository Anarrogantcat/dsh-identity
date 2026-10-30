/**
 * web / 非 QQ 会话的成长入口：接宿主 ctx.on('session/event')。
 * 只处理没有被通道适配器认领的会话（QQ 由 gate 自己记录），避免重复。
 */
import { appendEvent } from './events.js'
import { resolveSession } from './channel.js'
import { addMemory } from './memory.js'
import { redactForMemory } from './privacy.js'
import { audit } from './store.js'

/**
 * 宿主会往会话里塞一些"看起来像用户消息"的东西：运行环境快照、技能目录提醒、
 * 系统提示词副本、每一步的时间采样行。它们不是群友说的话，记进记忆就是污染——
 * 以后还会被当成"你自己说的/群友说的"再注回提示词。这里按特征剔掉。
 */
const HOST_BLOCK_RES = [
  /<system-reminder>[\s\S]*?<\/system-reminder>/gi,
  /<system-reminder>[\s\S]*$/i, // 未闭合的截断块
]
// 宿主每步会插的元信息行：整行丢掉，真话照留
// （"Elapsed since the preceding step context" 和 "...model-visible message" 都是它）
const HOST_LINE_RES = [
  /^time sampled while preparing turn\b.*$/gim,
  /^elapsed since the preceding\b.*$/gim,
  /^browser time zone for this request\b.*$/gim,
]
const HOST_ONLY_RES = [
  /^current runtime context\./i,
  /this snapshot supersedes earlier runtime-context snapshots/i,
  /^you are an ai agent powered by deepseek harness/i,
  /^the runtime context names the deepseek harness implementation checkout/i,
]

/** 剥掉宿主注入块；整条都是注入就返回空串 */
export function stripHostInjection(text, cfg) {
  if (cfg?.memory?.skipHostInjection === false) return String(text ?? '')
  let t = String(text ?? '')
  for (const re of HOST_BLOCK_RES) t = t.replace(re, ' ')
  for (const re of HOST_LINE_RES) t = t.replace(re, ' ')
  const head = t.replace(/\s+/g, ' ').trim()
  if (!head) return ''
  if (HOST_ONLY_RES.some((re) => re.test(head))) return ''
  return head
}

/**
 * 消息里可能有几段：reasoning / tool-call / text。
 * 只有 type 是 text 的才是"她说出口的话"。以前只排除 tool，
 * 结果每条 assistant/message 都把 reasoning（内部草稿）当发言记下来——
 * 5627 条消息里 4664 条根本没有正文，全被记成了英文独白。
 */
function textOf(v, depth = 0) {
  if (depth > 5 || v == null) return ''
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return v.map((x) => textOf(x, depth + 1)).filter(Boolean).join(' ')
  if (typeof v === 'object') {
    if (typeof v.text === 'string') {
      if (v.type == null || v.type === 'text') return v.text
      return '' // reasoning / tool-call / image … 都不是发言
    }
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
        const cfg = getConfig?.() ?? {}
        // 先剥注入再折叠空白：时间采样行的特征是按行识别的，先折叠就认不出来了
        const text = stripHostInjection(textOf(raw), cfg).replace(/\s+/g, ' ').trim().slice(0, 300)
        if (!text) return
        const origin = type === 'assistant/message' ? 'bot' : 'inbound'
        const pk = 'web_' + sid
        const ref = sid + ':' + String(event?.seq ?? event?.id ?? event?.data?.turn ?? Date.now())
        appendEvent(pk, { kind: 'talk', origin, text: redactForMemory(text, cfg), ref })
        if (origin === 'inbound' && cfg.memory?.enabled) {
          try { addMemory(pk, { text: redactForMemory(text, cfg), category: 'event', importance: 0.3, source: 'web', origin: 'user' }, cfg) } catch { /* ignore */ }
        }
        try { audit('web.growth', { sid: String(sid).replace(/^session-/, '').slice(0, 8), origin, len: text.length }) } catch { /* ignore */ }
      } catch (err) {
        logger.warn?.('[identity] session growth failed: ' + (err?.message ?? err))
      }
    })
    return true
  } catch { return false }
}
