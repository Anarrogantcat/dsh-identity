/**
 * 模型评估心情（可选，花 token，带预算闸）
 *
 * 攒 N 条群消息 → 调一次模型，让它判断「大肥鱼听完这些话，七维情绪各变化多少」。
 * 输出严格 JSON，解析失败就当这次没发生（不影响聊天）。
 *
 * 预算：integration.llmDailyTokens（默认 20000），当天用完就不再调，第二天自动恢复。
 * 理由只落盘给面板看，**不进 QQ 的提示词**——群里是公开场合，不能把聊天内容带出去。
 */
import { join } from 'node:path'
import { readJson, writeJson, dirs } from './store.js'
import { applyDimDelta, readLocalMood } from './moodlocal.js'

const PATH = join(dirs.root, 'moodllm.json')
const DIMS = ['happy', 'calm', 'sweet', 'heartache', 'worry', 'sad', 'jealous']
const buf = new Map()

const todayStr = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function loadBudget() {
  const j = readJson(PATH, null)
  const today = todayStr()
  if (!j || j.date !== today) return { date: today, tokens: 0, calls: 0, lastReason: '', lastAt: 0, lastError: '', lastRaw: '', failStreak: 0 }
  return { lastReason: '', lastAt: 0, lastError: '', lastRaw: '', failStreak: 0, ...j }
}

const MAX_FAIL_STREAK = 3

/** 连续解析失败会自己暂停（别再烧 token） */
export function isPaused() {
  return Number(loadBudget().failStreak ?? 0) >= MAX_FAIL_STREAK
}

function saveBudget(b) {
  writeJson(PATH, b)
}

export function budgetLeft(cfg) {
  const cap = Number(cfg?.integration?.llmDailyTokens ?? 20000)
  const b = loadBudget()
  return Math.max(0, cap - b.tokens)
}

export function llmStats() {
  const b = loadBudget()
  return {
    date: b.date, tokens: b.tokens, calls: b.calls,
    lastReason: b.lastReason, lastAt: b.lastAt, lastError: b.lastError,
    lastRaw: b.lastRaw ?? '', failStreak: Number(b.failStreak ?? 0),
    paused: Number(b.failStreak ?? 0) >= MAX_FAIL_STREAK,
  }
}

/** 面板「重置」用：清掉熔断状态，允许重新尝试 */
export function resetLlmState() {
  const b = loadBudget()
  b.failStreak = 0
  b.lastError = ''
  b.lastRaw = ''
  saveBudget(b)
  return true
}

export function pushMessage(peerKey, text, role) {
  const t = String(text ?? '').trim().slice(0, 200)
  if (!t) return
  const arr = buf.get(peerKey) ?? []
  arr.push({ role: role === 'owner' ? '群主' : role === 'admin' ? '管理' : '群友', text: t })
  while (arr.length > 60) arr.shift()
  buf.set(peerKey, arr)
}

export function bufferSize(peerKey) {
  return (buf.get(peerKey) ?? []).length
}

export function clearBuffer(peerKey) {
  buf.delete(peerKey)
}

export function buildPrompt(peerKey, every) {
  const arr = (buf.get(peerKey) ?? []).slice(-every)
  const lines = arr.map((m) => `${m.role}：${m.text}`).join('\n')
  return [
    '你在给一个群聊机器人「大肥鱼」（一条 AI 胖鱼，群里的成员）评估心情。下面是刚发生的群聊。',
    '要求：**只输出一行 JSON**。不要解释、不要前言、不要代码块、不要标点以外的任何字符。',
    '格式（七个数字都在 -2..2 之间，reason 不超过 20 字）：',
    '{"happy":0,"calm":0,"sweet":0,"heartache":0,"worry":0,"sad":0,"jealous":0,"reason":"不超过20字"}',
    '规则：每项范围 -2 到 2；没人提到她、也没人情绪化时，各项都应在 0.5 以内；被夸/叫她名字→happy 或 sweet 正数；被骂→sad 正数、happy 负数；有人在倾诉→heartache、worry 正数；有人暧昧但对象不是她→jealous 小正数。',
    '聊天记录：',
    lines,
  ].join('\n')
}

/** 宽松解析：模型经常带解释/代码块/中文引号，尽量把七个数字抠出来 */
export function parseAppraisal(text) {
  let raw = String(text ?? '').trim()
  if (!raw) return null
  // 去代码块围栏
  raw = raw.replace(/^\s*```[a-zA-Z]*\s*/g, '').replace(/\s*```\s*$/g, '').trim()

  let obj = null
  const brace = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (brace >= 0 && end > brace) {
    const slice = raw.slice(brace, end + 1)
    try { obj = JSON.parse(slice) } catch {
      // 中文引号 / 单引号 / 尾逗号 的常见修法
      try { obj = JSON.parse(slice.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/,\s*([}\]])/g, '$1')) } catch { obj = null }
    }
  }

  const dims = {}
  let any = false
  const put = (d, v) => {
    const n = Number(v)
    if (!Number.isFinite(n) || n === 0) return
    dims[d] = Math.max(-2, Math.min(2, n))
    any = true
  }
  let reason = ''
  if (obj && typeof obj === 'object') {
    for (const d of DIMS) put(d, obj[d] ?? 0)
    reason = String(obj.reason ?? obj.reasonZh ?? '').slice(0, 40)
  }
  // JSON 不通就退化成「正则抠数字」（模型写成 happy: 1.2 这种也能救）
  if (!any) {
    for (const d of DIMS) {
      const m = raw.match(new RegExp(`["']?${d}["']?\\s*[:：=]\\s*["']?(-?\\d+(?:\\.\\d+)?)`, 'i'))
      if (m) put(d, m[1])
    }
    if (!reason) {
      const rm = raw.match(/reason["']?\s*[:：=]\s*["']?([^"'，,。；;\n]{1,40})/i)
      if (rm) reason = rm[1].slice(0, 40)
    }
  }
  const complete = obj && typeof obj === 'object' && DIMS.every((d) => d in obj)
  // 关键：模型老实输出全 0（群里没人提她）也是有效结果，不能当失败
  if (!any && !reason && !complete) return null
  return { dims, reason, complete: !!complete }
}

function estTokens(...parts) {
  const chars = parts.reduce((n, p) => n + String(p ?? '').length, 0)
  return Math.max(50, Math.ceil(chars / 1.6))
}

/** 调一次模型；llm 是宿主的 llm 句柄（llm.stream） */
export async function appraiseWithLlm(cfg, llm, peerKey, logger = console) {
  if (!cfg?.integration?.llmEnabled) return { ok: false, error: '未开启' }
  const prov = cfg?.integration?.llmProvider
  const model = cfg?.integration?.llmModel
  if (!prov || !model || !llm?.stream) return { ok: false, error: '没有可用的 llm provider/model' }
  if (isPaused()) return { ok: false, error: `连续 ${MAX_FAIL_STREAK} 次解析失败，今天暂停（明天自动恢复，或在面板重置）` }
  if (budgetLeft(cfg) <= 0) return { ok: false, error: '今日预算已用完' }
  if (bufferSize(peerKey) < 2) return { ok: false, error: '消息太少' }
  const every = Math.max(2, Number(cfg?.integration?.llmEvery ?? 20))
  const prompt = buildPrompt(peerKey, every)
  let out = ''
  try {
    try {
      for await (const c of llm.stream({ provider: prov, model, messages: [{ role: 'user', content: prompt }] })) {
        out += c?.text ?? c?.delta ?? c?.content ?? ''
      }
    } catch {
      for await (const c of llm.stream({ provider: prov, model, prompt })) out += c?.text ?? c?.delta ?? c?.content ?? ''
    }
  } catch (err) {
    const b = loadBudget()
    b.lastError = String(err?.message ?? err).slice(0, 120)
    b.lastAt = Date.now()
    saveBudget(b)
    return { ok: false, error: b.lastError }
  }
  const tokens = estTokens(prompt, out)
  const b = loadBudget()
  b.tokens += tokens
  b.calls += 1
  b.lastAt = Date.now()
  b.lastError = ''
  const parsed = parseAppraisal(out)
  if (!parsed) {
    b.lastError = '模型输出不是 JSON'
    b.lastRaw = String(out ?? '').slice(0, 200)
    b.failStreak = Number(b.failStreak ?? 0) + 1
    saveBudget(b)
    clearBuffer(peerKey)
    logger?.warn?.(`[qqbot-refine] 心情评估解析失败（已花 ${tokens} tokens）：${b.lastRaw.slice(0, 80)}`)
    return { ok: false, error: '解析失败', tokens, raw: b.lastRaw }
  }
  if (parsed.complete && !Object.keys(parsed.dims).length) {
    // 七项都是 0：这次没有情绪变化，算成功（不累计失败、不写状态）
    b.failStreak = 0
    saveBudget(b)
    clearBuffer(peerKey)
    return { ok: true, dims: {}, reason: parsed.reason || '无明显变化', tokens, noChange: true }
  }

  b.lastReason = parsed.reason
  b.failStreak = 0
  saveBudget(b)
  const res = applyDimDelta(parsed.dims, { source: 'llm', reason: parsed.reason })
  clearBuffer(peerKey)
  return { ok: true, dims: parsed.dims, reason: parsed.reason, tokens, score: res.after }
}
