/**
 * 主动搭话（内置版，替代 dsh-speak-up）
 *
 * 与 speak-up 的区别：它自己发消息，会绕过闸门；我们这套**先过闸**再开口。
 * 两道轨：
 *   · template（默认，0 token）：模板池 + 时段/记忆槽位
 *   · llm（可选，花 token）：调宿主 llm 生成一句，失败回落模板
 *
 * 触发前提（全部满足才开口）：
 *   白名单群 · 非闭麦 · 非免打扰 · 群静默 ≥ silentMinutes
 *   · 距上次主动 ≥ minGapMinutes · 当日未超 dailyPerGroup
 */
import { collectStream } from './llmtext.js'

const REASON_TEMPLATES = {
  promise: ['对了，之前答应的事我还没弄完，这两天给你准信。', '欠着的事我记着呢，别当我忘了。'],
  goal: ['刚想起那个要推进的事，我晚点做一步，做完说。', '那件批过的事我惦记着，今天挪一步。'],
  topic: ['刚才那个话题我还惦记着，后来咋样了？', '接着刚才的说，我越想越觉得有意思。'],
}

const TEMPLATES = {
  morning: ['早呀，今天想干点啥？', '起了吗？我先啃两口白饭。', '新的一天，先来口白饭压压惊。'],
  afternoon: ['这个点容易困……要不要聊两句提提神？', '下午好，我有点想摸鱼了，你呢？'],
  evening: ['晚上了，今天有什么顺利的事吗？', '收工了没？我这边刚把白饭吃完了。'],
  night: ['还没睡？我陪你一会儿。', '这么晚还在，是睡不着还是在干活？'],
  any: ['群里安静得能听见我嚼饭的声音了。', '有人吗？没事，我就是想问问。', '刚才聊到哪儿了？我好像走神了。'],
}

export function timeBucket(date = new Date()) {
  const h = date.getHours()
  if (h >= 5 && h < 11) return 'morning'
  if (h >= 11 && h < 17) return 'afternoon'
  if (h >= 17 && h < 23) return 'evening'
  return 'night'
}

/** 模板版：0 token，随机 + 时段 + 可选记忆槽 */
export function buildTemplate(cfg, opts = {}) {
  const reason = String(opts.reason || '')
  let pool = [...TEMPLATES[timeBucket()] ?? [], ...TEMPLATES.any]
  if (/承诺|答应|没做完/.test(reason)) pool = [...REASON_TEMPLATES.promise, ...pool]
  else if (/目标/.test(reason)) pool = [...REASON_TEMPLATES.goal, ...pool]
  else if (/话题/.test(reason)) pool = [...REASON_TEMPLATES.topic, ...pool]
  const text = pool[Math.floor(Math.random() * pool.length)]
  // memoryHint 只用来挑内容，绝不拼进正文（会泄露提示词 / 带出 [图片] 占位符）
  return { text, source: opts.memoryHint ? 'template+memory' : 'template' }
}

/** 智能版：调宿主 llm（配置了 provider/model 才会用） */
export async function buildWithLlm(cfg, llm, opts = {}) {
  const prov = cfg?.proactive?.llmProvider
  const model = cfg?.proactive?.llmModel
  if (!prov || !model || !llm?.stream) return null
  const prompt = [
    '你在一个 QQ 群里，话题刚停下来。你不是客服，是群里的人：因为下面这个理由，才顺口插一句。像人一样短、口语，别超过 30 字，不要 @ 所有人，不要提自己是 AI。',
    opts.reason ? '开口的理由：' + opts.reason : '',
    opts.memoryHint ? `可以顺口问一句：${opts.memoryHint}` : '',
    '只输出这句话本身。',
  ].filter(Boolean).join('\n')
  try {
    let out = ''
    try {
    const rr = await collectStream(llm, { provider: prov, model, prompt, maxTokens: 200 })
    out = rr.text
  } catch { /* ignore */ }
    const text = String(out).trim().split('\n')[0].slice(0, 60)
    if (text.length < 2) return null
    return { text, source: 'llm' }
  } catch {
    return null
  }
}

/** 时段 + 记忆提示（记忆条目仅取一句，不含敏感信息） */
export function memoryHintOf(items = []) {
  for (const it of items) {
    const t = String(it.text ?? '').trim()
    if (t.length >= 6 && t.length <= 40 && !/密码|密钥|身份证|卡号|手机号/.test(t)) return t
  }
  return ''
}

/** 连续失败降级：3 次失败后 30 分钟内只用模板 */
const llmHealth = { fail: 0, until: 0 }
export function llmHealthy() {
  return Date.now() >= llmHealth.until
}
function llmFail() {
  llmHealth.fail += 1
  if (llmHealth.fail >= 3) { llmHealth.until = Date.now() + 30 * 60000; llmHealth.fail = 0 }
}
function llmOk() { llmHealth.fail = 0 }
export function llmReset() { llmHealth.fail = 0; llmHealth.until = 0 }

/**
 * 混合模式：模板给骨架（时段 + 记忆槽），模型只负责把它说得更像人话。
 * 模型不可用/失败 → 原样用模板，绝不空口。
 */
export async function buildHybrid(cfg, llm, opts = {}) {
  const base = buildTemplate(cfg, opts)
  const pc = cfg?.proactive ?? {}
  const wantLlm = pc.mode === 'hybrid' || pc.mode === 'llm'
  if (!wantLlm) return base
  if (!llmHealthy()) return { ...base, source: base.source + '+llm-cooldown' }
  if (pc.llmOnlyWithMemory !== false && !opts.memoryHint) return base
  if (!pc.llmProvider || !pc.llmModel || !llm?.stream) return base
  const prov = pc.llmProvider
  const model = pc.llmModel

  const prompt = [
    '把下面这句群里的话改写成更自然的一句口语，像群里的人接着话头说，保持原意，不超过 30 字，不要 @ 所有人，不要提自己是 AI。',
    opts.reason ? '开口的理由：' + opts.reason : '',
    '原句：' + base.text,
    opts.memoryHint ? '可以顺口带一句：' + opts.memoryHint : '',
    '只输出改写后的那句话。',
  ].filter(Boolean).join('\n')
  try {
    let out = ''
    try {
    const rr = await collectStream(llm, { provider: prov, model, prompt, maxTokens: 200 })
    out = rr.text
  } catch { /* ignore */ }
    const text = String(out).trim().split('\n')[0].slice(0, 60)
    if (text.length < 2) { llmFail(); return { ...base, source: base.source + '+llm-empty' } }
    llmOk()
    return { text, source: 'hybrid', base: base.text }
  } catch {
    llmFail()
    return { ...base, source: base.source + '+llm-fail' }
  }
}


