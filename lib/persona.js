import { resolvePreset } from './presets.js'
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

export function personaText(cfg) {
  const custom = (cfg?.persona?.text ?? '').trim()
  return custom || DEFAULT_PERSONA
}

/** 按 作用域 解析生效人设（按私聊/按群 → 全局 current） */
export function personaFor(cfg, scope, peer) {
  try { return resolvePreset(cfg, scope, peer) } catch { return null }
}
