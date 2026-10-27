/**
 * 宿主 llm.stream 的调用封装
 *
 * 关键点（踩过的坑）：
 *  · messages.content 必须是 ContentBlock[]（[{type:'text',text}]），传字符串模型会收到空内容
 *  · chunk 是判别联合：{type:'text-delta', text} / {type:'reasoning-delta'} / {type:'finish', reason}
 *    只取 text-delta（reasoning-delta 是思考过程，不是答案）
 */
export function textBlocks(text) {
  return [{ type: 'text', text: String(text ?? '') }]
}

export async function collectStream(llm, opts) {
  const { provider, model, prompt, system, maxTokens = 400, temperature = 0, reasoningEffort = 'low', timeoutMs = 60000 } = opts || {}
  const out = []
  let finish = ''
  let usage = null
  const signal = timeoutMs > 0 && typeof AbortSignal !== 'undefined' ? AbortSignal.timeout(timeoutMs) : undefined
  const req = { provider, model, messages: [{ role: 'user', content: textBlocks(prompt) }], maxTokens, temperature }
  if (system) req.system = String(system)
  if (reasoningEffort) req.reasoningEffort = reasoningEffort
  if (signal) req.signal = signal
  for await (const c of llm.stream(req)) {
    if (!c) continue
    const type = c.type
    if (type === 'text-delta') { if (typeof c.text === 'string') out.push(c.text); continue }
    if (type === 'finish') { finish = typeof c.reason === 'string' ? c.reason : JSON.stringify(c.reason ?? ''); continue }
    if (type === 'usage') { usage = c.usage || null; continue }
    if (!type) {
      // 兼容旧宿主：直接给 text/delta 字段
      if (typeof c.text === 'string') out.push(c.text)
      else if (typeof c.delta === 'string') out.push(c.delta)
    }
  }
  return { text: out.join('').trim(), finish, usage }
}
