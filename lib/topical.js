// 多人聊天辅助：合并窗口 + 话题卡（本地规则，0 token）
// 合并窗口：同一个群 600ms 内的多条消息并成一批，一批只派发一次，避免半句接半句
// 话题卡：把最近几条消息拼成一句「现在谁在聊什么」，至少 3 条才出，不出就不占上下文

export const DEFAULT_WINDOW_MS = 600
export const TOPIC_MIN_MSGS = 3
export const TOPIC_MAX_CHARS = 120

/**
 * 合并窗口：按 peer 分桶，窗口结束后把桶里的消息一次性交给 onBatch
 * push() 返回 true 表示这是本次窗口的第一条（调用方只在这条上启动计时）
 */
export function createBatcher({ windowMs = DEFAULT_WINDOW_MS, onBatch, now = () => Date.now(), timer = setTimeout, clear = clearTimeout } = {}) {
  const buckets = new Map()
  let seq = 0
  function flush(peer) {
    const b = buckets.get(peer)
    if (!b) return
    buckets.delete(peer)
    if (b.timerId != null) clear(b.timerId)
    if (!b.items.length) return
    try { onBatch?.(peer, b.items) } catch { /* 单批失败不影响下一批 */ }
  }
  return {
    push(peer, item) {
      const key = String(peer ?? '')
      const b = buckets.get(key)
      if (b) { b.items.push(item); return false }
      const bucket = { items: [item], timerId: null, id: ++seq }
      buckets.set(key, bucket)
      bucket.timerId = timer(() => flush(key), windowMs)
      return true
    },
    flush,
    flushAll() { for (const k of [...buckets.keys()]) flush(k) },
    pending(peer) { const b = buckets.get(String(peer ?? '')); return b ? b.items.length : 0 },
    size() { return buckets.size },
  }
}

/** 抽话题词：中文二字词 + 英文/数字词，去掉寒暄和标点 */
const STOP = new Set(['哈哈', '哈哈', '一个', '这个', '那个', '什么', '怎么', '就是', '不是', '可以', '没有', '你们', '我们', '他们', '现在', '今天'])
export function topicWords(text, max = 3) {
  const t = String(text ?? '')
  const out = new Map()
  for (const m of t.matchAll(/[a-zA-Z0-9_]{2,}/g)) out.set(m[0].toLowerCase(), (out.get(m[0].toLowerCase()) ?? 0) + 1)
  const cjk = t.replace(/[^\u4e00-\u9fa5]+/g, ' ')
  for (const chunk of cjk.split(' ')) {
    for (let i = 0; i < chunk.length - 1; i++) {
      const w = chunk.slice(i, i + 2)
      if (STOP.has(w)) continue
      out.set(w, (out.get(w) ?? 0) + 1)
    }
  }
  return [...out.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([w]) => w)
}

/**
 * 话题卡：recent = [{ nick, text, at }]
 * 不足 TOPIC_MIN_MSGS 条、或谁都抽不出词时返回 ''（宁可不占上下文）
 */
export function topicCard(recent = [], { min = TOPIC_MIN_MSGS, maxChars = TOPIC_MAX_CHARS } = {}) {
  const list = (Array.isArray(recent) ? recent : []).filter((m) => m && String(m.text ?? '').trim())
  if (list.length < min) return ''
  const byNick = new Map()
  for (const m of list) {
    const nick = String(m.nick ?? '').trim() || '有人'
    const words = topicWords(m.text)
    if (!byNick.has(nick)) byNick.set(nick, new Set())
    for (const w of words) byNick.get(nick).add(w)
  }
  const parts = []
  for (const [nick, words] of byNick) {
    const ws = [...words].slice(0, 2)
    if (!ws.length) continue
    parts.push(`${nick} 在聊 ${ws.join('/')}`)
  }
  if (parts.length < 2 && list.length < 4) return ''
  const text = '现在群里：' + parts.slice(0, 4).join('；')
  return text.length > maxChars ? text.slice(0, maxChars - 1) + '…' : text
}
