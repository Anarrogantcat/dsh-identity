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
  if (!j || j.date !== today) return { date: today, tokens: 0, calls: 0, lastReason: '', lastAt: 0, lastError: '' }
  return { lastReason: '', lastAt: 0, lastError: '', ...j }
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
  return { date: b.date, tokens: b.tokens, calls: b.calls, lastReason: b.lastReason, lastAt: b.lastAt, lastError: b.lastError }
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
    '请只输出一个 JSON 对象，不要解释、不要代码块：',
    '{"happy":0,"calm":0,"sweet":0,"heartache":0,"worry":0,"sad":0,"jealous":0,"reason":"不超过20字"}',
    '规则：每项范围 -2 到 2；没人提到她、也没人情绪化时，各项都应在 0.5 以内；被夸/叫她名字→happy 或 sweet 正数；被骂→sad 正数、happy 负数；有人在倾诉→heartache、worry 正数；有人暧昧但对象不是她→jealous 小正数。',
    '聊天记录：',
    lines,
  ].join('\n')
}

export function parseAppraisal(text) {
  const raw = String(text ?? '')
  const brace = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (brace < 0 || end <= brace) return null
  let obj
  try { obj = JSON.parse(raw.slice(brace, end + 1)) } catch { return null }
  if (!obj || typeof obj !== 'object') return null
  const dims = {}
  let any = false
  for (const d of DIMS) {
    const v = Number(obj[d] ?? 0)
    if (!Number.isFinite(v) || v === 0) continue
    dims[d] = Math.max(-2, Math.min(2, v))
    any = true
  }
  const reason = String(obj.reason ?? '').slice(0, 40)
  if (!any && !reason) return null
  return { dims, reason }
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
  if (bufferSize(peerKey) < 2) return { ok: false, error: '消息太少' }
  if (budgetLeft(cfg) <= 0) return { ok: false, error: '今日预算已用完' }
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
    saveBudget(b)
    clearBuffer(peerKey)
    logger?.warn?.(`[qqbot-refine] 心情评估解析失败（已花 ${tokens} tokens）`)
    return { ok: false, error: '解析失败', tokens }
  }
  b.lastReason = parsed.reason
  saveBudget(b)
  const res = applyDimDelta(parsed.dims, { source: 'llm', reason: parsed.reason })
  clearBuffer(peerKey)
  return { ok: true, dims: parsed.dims, reason: parsed.reason, tokens, score: res.after }
}
