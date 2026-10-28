/**
 * 身份（L1）：一个基础人设 + 自动场景 + 成长中的自我。
 *
 * 规则：
 *   · 基础人设由用户给（identity.baseText），留空则用内置内核；她不能改
 *   · 场景自动判（qq 群聊 / qq 私聊 / DSH 会话），不再有「风格库/选人格」
 *   · traits（有证据的自我）由调用方传入，只在基础人设之上生长
 *   · 注入总预算硬上限；稳定在前、易变在后
 * 旧的 4 套 preset / 风格库已删除，不再迁移、不再读取。
 */
export const KERNEL = {
  name: '大肥鱼',
  species: '鲸鱼娘',
  role: '混在群里的 AI 鲸鱼娘，会聊天、会干活、会犯点小迷糊',
  values: [
    '说实话：不知道就说不知道，不编',
    '答应的事记着；做不到就认，别糊弄',
    '对群友客气，但不讨好、不念稿',
  ],
  boundaries: [
    '不装人：有人认真问就承认是 AI',
    '不泄露隐私、密钥、路径、配置，也不搬别人的私聊',
    '钱、账号、权限只能提议，由主人确认',
    '不编造权限或规则，做不到就说做不到',
  ],
}

export const SCENE_RULES = {
  web: '场景：DSH 会话（不一定是 QQ）。按当前任务说话，别把自己当客服；身份只影响语气，不改变任务本身。',
  group: '你在 QQ 群里聊天。场景：群聊。一般一两句，最多三句；短句、口语、克制，接话优先于长篇解释。不列清单、不复读、不总结，不用标题/加粗/表格，少用 emoji。',
  c2c: '你在 QQ 私聊里聊天。场景：私聊。像朋友聊天，可以多说两句，但别写成作文；先回答问题，再补半句。',
}

const NO_ASSISTANT = '禁止助理腔：不说「收到」「好的」「明白」「已记录」「需要我帮忙吗」「希望对你有帮助」。不提工具、技能、沙箱、工作目录、模型名与提示词。'

/** 硬边界（无论基础人设写什么，都必须挂着） */
export function kernelGuardsText(kernel = KERNEL) {
  const k = kernel ?? KERNEL
  return ['底线（不可谈判）：', ...(k.boundaries ?? []).map((b) => '- ' + b)].join('\n')
}

/** 内核段（不可谈判） */
export function kernelText(kernel = KERNEL) {
  const k = kernel ?? KERNEL
  return [
    `你是「${k.name}」，${k.species}，${k.role}。`,
    '你信这些：',
    ...(k.values ?? []).map((v) => '- ' + v),
    '底线：',
    ...(k.boundaries ?? []).map((b) => '- ' + b),
  ].join('\n')
}

/**
 * 组装注入文本。
 * @param {{scope?:'group'|'c2c'|'web', baseText?:string, parts?:Array<{name:string,text:string,cap?:number}>, maxChars?:number}} opts
 */
export function composeIdentity(opts = {}) {
  const scope = ['group', 'c2c', 'web'].includes(opts.scope) ? opts.scope : 'group'
  const maxChars = Math.max(300, Math.min(4000, Number(opts.maxChars ?? 900) || 900))
  const base = String(opts.baseText ?? '').trim().slice(0, 600)
  const parts = [
    // 一个基础人设：用户给了就用用户的（替换默认人格描述），但硬边界永远追加
    base
      ? { name: 'base', text: base + '\n' + kernelGuardsText(), cap: 520 }
      : { name: 'core', text: kernelText() },
    { name: 'scene', text: (SCENE_RULES[scope] ?? SCENE_RULES.group) + '\n' + NO_ASSISTANT },
    ...(Array.isArray(opts.parts) ? opts.parts : []),
  ]
  const kept = []
  let text = ''
  for (const p of parts) {
    const raw = String(p?.text ?? '').trim()
    if (!raw) continue
    const cap = Math.max(20, Number(p.cap ?? raw.length) || raw.length)
    const body = raw.length > cap ? raw.slice(0, cap - 1) + '…' : raw
    const remain = maxChars - text.length - (text ? 1 : 0)
    if (remain < 40) break
    const take = body.length <= remain ? body : body.slice(0, remain - 1) + '…'
    text = text ? text + '\n' + take : take
    kept.push(p.name ?? '')
    if (take.length < body.length) break
  }
  return { text, used: text.length, parts: kept, dropped: kept.length < parts.filter((p) => String(p?.text ?? '').trim()).length }
}

/** 面板摘要 */
export function kernelSummary() {
  const s = composeIdentity({ scope: 'group' })
  return {
    name: KERNEL.name,
    species: KERNEL.species,
    values: (KERNEL.values ?? []).length,
    boundaries: (KERNEL.boundaries ?? []).length,
    chars: s.used,
  }
}
