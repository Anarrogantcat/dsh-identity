/**
 * 通道适配器（L5 契约）：身份 / 认知 / 治理只认这个接口，不认 QQ。
 *
 * adapter = {
 *   id: string,                 // 'qq' | 'web' | ...
 *   name: string,
 *   resolveSession(sid) => ({ scope, peer, peerKey } | null),  // 会话 → 对话对象
 *   describe() => object        // 面板/诊断用
 * }
 *
 * 新增通道（Web、Discord、命令行…）只需要注册一个 adapter，身份段/认知/治理不用改。
 */
const adapters = new Map()

export function registerChannel(adapter) {
  const id = String(adapter?.id ?? '')
  if (!id) throw new Error('通道必须有 id')
  adapters.set(id, {
    id,
    name: String(adapter.name ?? id),
    resolveSession: typeof adapter.resolveSession === 'function' ? adapter.resolveSession : () => null,
    describe: typeof adapter.describe === 'function' ? adapter.describe : () => ({ id, name: String(adapter.name ?? id) }),
  })
  return id
}

export function getChannel(id) { return adapters.get(String(id)) ?? null }

export function listChannels() {
  return [...adapters.values()].map((a) => ({ id: a.id, name: a.name }))
}

/** 按注册顺序找第一个能解析该 session 的通道；解析不到返回 null（不是错误） */
export function resolveSession(sessionId) {
  const sid = String(sessionId ?? '')
  if (!sid) return null
  for (const a of adapters.values()) {
    try {
      const r = a.resolveSession(sid)
      if (r && r.peerKey) return { ...r, channel: a.id, channelName: a.name }
    } catch { /* 单个适配器失败不影响其它通道 */ }
  }
  return null
}

/** 只用于测试/重载：清空注册表 */
export function resetChannels() { adapters.clear() }

/** 从宿主 context 里取 session id（通道无关） */
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
