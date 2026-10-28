/** QQ 通道适配器：把 persona 的 session→peer 映射接进通道契约 */
import { registerChannel, listChannels } from './channel.js'
import { peerOfSession } from './persona.js'
import { transportDescribe } from './transport.js'

registerChannel({
  id: 'qq',
  name: 'QQ（NapCat/OneBot）',
  resolveSession: (sid) => {
    const p = peerOfSession(sid)
    return p ? { scope: p.scope, peer: p.peer, peerKey: p.peerKey } : null
  },
  describe: () => {
    try { const t = transportDescribe(); return { id: 'qq', mode: t?.mode ?? '', channel: t?.channel?.selfHosted ? 'self-hosted' : '' } } catch { return { id: 'qq' } }
  },
})

export { listChannels }
