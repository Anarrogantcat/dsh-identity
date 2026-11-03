/**
 * 宿主 llm.stream 的调用封装
 *
 * 关键点（踩过的坑）：
 *  · messages.content 必须是 ContentBlock[]（[{type:'text',text}]），传字符串模型会收到空内容
 *  · chunk 是判别联合：{type:'text-delta', text} / {type:'reasoning-delta'} / {type:'finish', reason}
 *    只取 text-delta（reasoning-delta 是思考过程，不是答案）
 */
import { logModel } from './diaglog.js'

export function textBlocks(text) {
  return [{ type: 'text', text: String(text ?? '') }]
}

function tokensOf(usage) {
  if (!usage || typeof usage !== 'object') return 0
  const n = Number(usage.totalTokens ?? usage.total_tokens ?? 0)
  if (n > 0) return n
  return Number(usage.inputTokens ?? usage.prompt_tokens ?? 0) + Number(usage.outputTokens ?? usage.completion_tokens ?? 0)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 便宜模型被打回「Service is too busy」时，等一下再试一次，比直接当失败便宜 */
function isBusy(finish) {
  const s = String(finish || '')
  if (!s) return false
  if (!/error/i.test(s)) return false
  return /busy|rate|too many|429|503|overload/i.test(s)
}

export async function collectStream(llm, opts) {
  const { provider, model, prompt, system, maxTokens = 400, temperature = 0, reasoningEffort = 'low', timeoutMs = 60000, attempts = 2 } = opts || {}
  const started = Date.now()
  const signal = timeoutMs > 0 && typeof AbortSignal !== 'undefined' ? AbortSignal.timeout(timeoutMs) : undefined
  const req = { provider, model, messages: [{ role: 'user', content: textBlocks(prompt) }], maxTokens, temperature }
  if (system) req.system = String(system)
  if (reasoningEffort) req.reasoningEffort = reasoningEffort
  if (signal) req.signal = signal

  const attempt = async () => {
    const out = []
    let finish = ''
    let usage = null
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

  let res = { text: '', finish: '', usage: null }
  let used = 0
  // 有的 provider 直接拒 reasoningEffort: none（UNSUPPORTED_REASONING_EFFORT）：
  // 去掉这个参数再要一次，别把它当模型失败（这次重试也算在 attempts 里）
  const budget = Math.max(1, attempts)
  for (let i = 0; i < budget; i++) {
    used += 1
    try {
      res = await attempt()
    } catch (err) {
      try { logModel({ kind: opts?.kind || 'text', provider, model, ms: Date.now() - started, tokens: 0, ok: false, error: (err && err.message) || String(err), attempts: used }) } catch { /* ignore */ }
      throw err
    }
    if (res.text) break
    if (/UNSUPPORTED_REASONING_EFFORT/i.test(String(res.finish)) && req.reasoningEffort) {
      delete req.reasoningEffort
      continue
    }
    if (!isBusy(res.finish) || i >= budget - 1) break
    await sleep(700)
  }

  const badFinish = /error|abort|timeout|max-tokens/i.test(String(res.finish))
  const ok = !!res.text && !badFinish
  try {
    logModel({
      kind: opts?.kind || 'text', provider, model, ms: Date.now() - started,
      tokens: tokensOf(res.usage), ok, attempts: used,
      error: ok ? '' : ('finish=' + (res.finish || 'none') + (res.text ? '' : ' 无正文')),
    })
  } catch { /* ignore */ }
  return res
}
