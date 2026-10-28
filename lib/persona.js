/** 人格注入：只对 QQ 会话生效（靠 sessionId → peer 映射） */
export const DEFAULT_PERSONA = `你是 QQ 群里的一员，不是客服：一般就回一句，最多两句，用短句接着说，不写段落。
不用标题、列表、加粗、表格；不客套、不总结成文、不罗列、不复读别人的问题。
不知道就说不知道，不确定就说「好像是」，不硬编。别人认真问你是不是 AI，就老实承认。
比赛、比分、新闻、价格这类会变的事实，先 web_search 再答：结论一句 + 依据一句，查不到就说没查到。
不抢话、不透露本机信息、密钥、模型与接口细节。`

const sidToPeer = new Map()

/** 由 scope/peer 推出 qqbot 的会话 id（与 dsh-qqbot 的派生一致：sha256(key) → uuid 形态） */
export function sessionIdFor(appId, scope, peer) {
  if (!appId) return null
  return import('node:crypto').then(({ createHash }) => {
    const hash = createHash('sha256').update(`qqbot:${appId}:${scope}:${peer}`).digest('hex')
    return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`
  })
}

export function rememberSession(sid, peerKey, scope, peer) {
  if (!sid) return
  sidToPeer.set(sid, { peerKey, scope, peer })
}

export function peerOfSession(sid) {
  return sidToPeer.get(sid) ?? null
}

export function sessionIdOfContext(context) {
  if (!context || typeof context !== 'object') return null
  const candidates = [
    context.session?.id,
    context.sessionId,
    context.session?.sessionId,
    context.agent?.session?.id,
    context.agent?.sessionId,
    context.agent?.id,
  ]
  for (const c of candidates) if (typeof c === 'string' && c.length >= 8) return c
  return null
}

/** 聊天尺度 → 一段语气指引（0 保守 … 100 放飞；底线不随尺度变） */
export function scaleBlock(scale) {
  const n = Math.max(0, Math.min(100, Number(scale ?? 50)))
  let tier = ''
  if (n <= 25) tier = '保守：只回答问题，不接梗、不吐槽、不卖萌，用词克制，不主动开玩笑。'
  else if (n <= 50) tier = '日常：像普通群友，可以顺口吐槽一句，但不主动损人、不开荤段子。'
  else if (n <= 75) tier = '放松：会接梗、会损人（不针对外貌/家人）、会自嘲，语气更随意，可以偶尔来一句荤的。'
  else tier = '放飞：说话更冲更皮，接梗、损人、脏话、荤段子都可以；但别过火。'
  return [
    '',
    '# 聊天尺度（' + n + '/100）',
    tier,
    '尺度只改语气和放开程度；事实准确性、隐私、危险操作这些底线不跟着变。',
  ].join('\n')
}
/**
 * 尺度 + 状态叠加：设定是你的手，心情和关系是她的状态。
 *   · 生气/低落 → 比设定更收敛（-15/-12）
 *   · 松快 → 更放得开（+8）
 *   · 跟群里的人熟（bondAvg ≥ 4）→ +8；别扭（≤ -3）→ -8
 * 结果限制在 0~100；只影响语气，事实、边界、安全规则不变。
 */
export function effectiveScale(base, { tone = '', bondAverage = 0 } = {}) {
  const b = Math.max(0, Math.min(100, Number(base) || 50))
  let off = 0
  const t = String(tone || '')
  if (t === '生气' || t === '低落') off -= 15
  else if (t === '别扭') off -= 6
  else if (t === '松快') off += 8
  if (Number(bondAverage) >= 4) off += 8
  else if (Number(bondAverage) <= -3) off -= 8
  const v = Math.max(0, Math.min(100, b + off))
  return { scale: v, offset: v - b }
}
