/** 统一软判断入口：不碰安全/命令硬规则，只决定“这条要不要接” */
export function decideReply({ toMe = false, nameHit = false, youAsk = false, askOk = false, modelDirected = false, mentionDefault = false } = {}) {
  if (mentionDefault) return { reply: true, source: 'mention-default', reason: '被提到，默认接一句' }
  if (nameHit) return { reply: true, source: 'name', reason: '叫了名字' }
  if (toMe) return { reply: true, source: 'directed', reason: '语义上在对她说' }
  if (youAsk) return { reply: true, source: 'you-ask', reason: '在问她' }
  if (askOk) return { reply: true, source: 'group-ask', reason: '群里在问，可能接' }
  if (modelDirected) return { reply: true, source: 'model', reason: '判断器认为该接' }
  return { reply: false, source: 'none', reason: '没有接话信号' }
}

const HARD = {
  otherMention: '对方在 @ 别人，不接',
  reaction: '纯反应/跟话，不接',
  cooldown: '刚说过，冷却中',
  noSignal: '没有接话信号',
}

/** 硬规则也只在这里下结论；gate 只负责执行 */
export function decideHard(code, detail = '') {
  const reason = HARD[code] || String(code || '硬规则不接')
  return { reply: false, source: 'hard:' + code, reason: detail ? reason + '（' + detail + '）' : reason }
}

/** 主动开口的结论也走这里，不再由 gate 自写 */
export function decideProactive({ reason = '', allowed = true } = {}) {
  if (!allowed) return { reply: false, source: 'proactive:skip', reason: String(reason || '没有理由') }
  return { reply: true, source: 'proactive', reason: String(reason || '主动开口') }
}

/** 唯一入口：硬规则、软判断、主动都从这里出结论 */
export function decide(opts = {}) {
  if (opts && opts.proactive) return decideProactive(opts)
  if (opts && opts.hard) return decideHard(opts.hard, opts.detail || '')
  return decideReply(opts)
}
