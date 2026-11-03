/**
 * 判断蒸馏：把一段对话压成「以后能改变做法」的判断，而不是原话。
 *
 * 原话留在事件流里当证据；记忆只存结论——「他关心的是有感觉，不是功能清单」
 * 比「他说精力没生效」更能影响下一次。判断卡 importance 高，注入时自然压过碎屑。
 */
import { addMemory, listMemory, tokenize } from './memory.js'
import { collectStream } from './llmtext.js'
import { audit } from './store.js'

const MIN_CHARS = 4
const BUF_MAX = 16
const PREVIEW = 240

const buf = new Map() // peerKey -> [{ role, text }]
const pending = new Map() // peerKey -> 还没蒸馏的条数
const lastAt = new Map() // peerKey -> 上次尝试时间

const clamp = (n) => Math.max(0, Math.min(1, Number(n) || 0))

/** 只在内存里攒，不落盘：攒的是「这一段」的语境，落盘没必要 */
export function pushTalk(peerKey, role, text) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (t.length < MIN_CHARS) return
  const arr = buf.get(peerKey) || []
  arr.push({ role, text: t.slice(0, PREVIEW) })
  if (arr.length > BUF_MAX) arr.splice(0, arr.length - BUF_MAX)
  buf.set(peerKey, arr)
  pending.set(peerKey, (pending.get(peerKey) || 0) + 1)
}

/** 够不够格蒸馏：按条数 + 冷却，避免每句都去调模型 */
export function due(peerKey, cfg, now = Date.now()) {
  if (cfg?.memory?.judge === false) return false
  const n = pending.get(peerKey) || 0
  const every = Math.max(3, Number(cfg?.memory?.judgeEvery ?? 6))
  if (n < every) return false
  const cool = Math.max(60000, Number(cfg?.memory?.judgeCooldownMin ?? 30) * 60000)
  if (now - (lastAt.get(peerKey) || 0) < cool) return false
  return true
}

export const JUDGE_PROMPT = [
  '你是记忆整理器。下面是「大肥鱼」（AI）和「对方」的一段对话。',
  '只写「以后能改变大肥鱼做法」的判断，最多 3 条。',
  '优先写「对方是什么样的人」：在意什么、烦什么、习惯怎么说话、跟谁什么关系、什么话题会来劲。',
  '「机器怎么修」这类只有这一次有用的技术细节别写，除非对方明显在意它。',
  // 先核实再断言（linghun 的「最小可用三条」）：宁可少写，也不把猜的写成结论
  '写之前先核实：对话里找得到依据的才写，找不到依据的一条都不写；是推断就写成推断，别写成事实。',
  '每条一行，30 字以内，直接写结论；不要编号、不要解释、不要 JSON，也不要复述聊天。',
  '拿不准就不写；没有值得记的就一个字都不写。',
  '',
  '对话：',
].join('\n')
const PROMPT = JUDGE_PROMPT

/** 从模型输出里抠 JSON 数组；不走正则匹配引号，直接取首尾括号再 parse */
export function parseJudgments(text) {
  const s = String(text ?? '').trim()
  if (!s) return []
  const out = []
  // 先试 JSON 数组
  const a = s.indexOf('[')
  const b = s.lastIndexOf(']')
  if (a >= 0 && b > a) {
    try {
      const arr = JSON.parse(s.slice(a, b + 1))
      if (Array.isArray(arr)) {
        for (const it of arr) {
          const t = String(it?.text ?? '').replace(/\s+/g, ' ').trim()
          if (t.length < 4 || t.length > 60) continue
          const cat = ['preference', 'fact', 'relation'].includes(String(it?.category)) ? String(it.category) : 'fact'
          out.push({
            text: t.slice(0, 60),
            category: cat,
            importance: clamp(it?.importance ?? 0.55),
            emotion: clamp(it?.emotion ?? 0),
            valence: Math.max(-1, Math.min(1, Number(it?.valence) || 0)),
          })
        }
      }
    } catch { /* 落到按行解析 */ }
  }
  // 兜底：模型没按格式给 JSON，就把它写的判断按行读
  if (!out.length) {
    for (const line of s.split(/\n+/)) {
      const t = line.replace(/^[-*\d.、)\s]+/, '').replace(/^["「]|["」]$/g, '').trim()
      if (t.length < 4 || t.length > 60) continue
      if (/^(以下|判断|规则|输出|对话|每条|只输出)/.test(t)) continue
      // 带括号/花括号的多半是半截 JSON，不是人话判断
      if (/[\[\]{}]/.test(t)) continue
      out.push({ text: t.slice(0, 60), category: 'preference', importance: 0.55, emotion: 0, valence: 0 })
      if (out.length >= 3) break
    }
  }
  return out.slice(0, 3)
}

/** 两条判断说的是同一件事就不要再堆一条 */
function overlap(a, b) {
  const A = new Set(tokenize(a))
  const B = new Set(tokenize(b))
  if (!A.size || !B.size) return 0
  let hit = 0
  for (const w of A) if (B.has(w)) hit++
  return hit / Math.min(A.size, B.size)
}

/**
 * 调一次模型把缓冲压成判断。失败就静默返回（下一次要等冷却），
 * 原话还在事件流里，不会丢事实。
 */
export async function distill(peerKey, { cfg, llm, logger = console } = {}) {
  const arr = buf.get(peerKey) || []
  const skip = (why, extra = {}) => {
    try { audit('memory.judgeSkip', { peer: String(peerKey).slice(0, 12), why, ...extra }) } catch { /* ignore */ }
    return { ok: false, n: 0, error: why }
  }
  if (arr.length < 2) return skip('too-few', { n: arr.length })
  if (!llm?.stream) return skip('no-llm')
  const prov = cfg?.integration?.llmProvider
  const model = cfg?.integration?.llmModel
  if (!prov || !model) return skip('no-route', { prov: String(prov || ''), model: String(model || '') })

  lastAt.set(peerKey, Date.now())
  const dialog = arr.map((x) => (x.role === 'self' ? '大肥鱼：' : '对方：') + x.text).join('\n').slice(-1200)

  let out = ''
  let meta = {}
  try {
    // 先强制不思考：这模型一思考就把 token 全烧在脑子里，正文一个字不剩（实测 900 用满、out 空）。
    // 但有的 provider 直接拒 none（UNSUPPORTED_REASONING_EFFORT），collectStream 里会自动去掉参数重试
    const r = await collectStream(llm, {
      provider: prov, model, prompt: PROMPT + dialog,
      maxTokens: 2000, reasoningEffort: 'none', timeoutMs: 90000,
    })
    out = r.text
    meta = { finish: String(r.finish || '').slice(0, 120), usage: r.usage ? JSON.stringify(r.usage).slice(0, 160) : '' }
    // 还是空：换默认推理档再要一次
    if (!out) {
      const r2 = await collectStream(llm, { provider: prov, model, prompt: PROMPT + dialog, maxTokens: 2000, timeoutMs: 90000 })
      out = r2.text
      meta.retry = true
      meta.finish = String(r2.finish || '').slice(0, 120)
    }
  } catch (err) {
    const msg = String(err?.message ?? err).slice(0, 120)
    logger?.warn?.('[identity] 判断蒸馏失败：' + msg)
    return skip('error', { msg })
  }

  const items = parseJudgments(out)
  const existing = (() => { try { return listMemory(peerKey).map((x) => String(x.text ?? '')) } catch { return [] } })()
  let n = 0
  for (const it of items) {
    if (existing.some((x) => overlap(x, it.text) >= 0.7)) continue
    try {
      addMemory(peerKey, {
        text: it.text,
        category: it.category,
        importance: it.importance,
        emotion: it.emotion,
        valence: it.valence,
        source: 'judge',
        origin: 'agent',
      }, cfg)
      existing.push(it.text)
      n += 1
    } catch { /* 单条失败不影响其它 */ }
  }

  pending.set(peerKey, 0)
  // 留着最近两条当下一段的开头，别把语境切太干净
  buf.set(peerKey, arr.slice(-2))
  try { audit('memory.judge', { peer: String(peerKey).slice(0, 12), n, got: items.length, out: out.slice(0, 80), ...meta }) } catch { /* ignore */ }
  return { ok: true, n, got: items.length }
}

/** 测试和面板用：看某条缓冲里攒了什么 */
export function buffered(peerKey) { return (buf.get(peerKey) || []).slice() }
export function pendingCount(peerKey) { return pending.get(peerKey) || 0 }
