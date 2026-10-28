/**
 * P17 通道抽象测试：身份/认知只认通道契约，QQ 只是其中一个 adapter
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-p17-'))
delete process.env.QQBOT_REFINE_HOME
const url = (p) => new URL(p, import.meta.url).href
const C = await import(url('../lib/channel.js'))
const { ensureStore } = await import(url('../lib/config.js'))
const { ensureDirs, peerKey } = await import(url('../lib/store.js'))
const { rememberSession } = await import(url('../lib/persona.js'))
await import(url('../lib/channel-qq.js'))
ensureStore(); ensureDirs()
const ok = []
const T = (n, p, d) => ok.push([n, !!p, d])

const channels = C.listChannels()
T('QQ 是注册的通道之一', channels.some((c) => c.id === 'qq'), channels)
T('未知会话解析为 null（不报错）', C.resolveSession('unknown-session-xyz') === null)

const sid = '11112222-3333-4444-5555-666677778888'
const pk = peerKey('group', 'G1')
rememberSession(sid, pk, 'group', 'G1')
const r = C.resolveSession(sid)
T('解析出对话对象', r && r.peerKey === pk && r.scope === 'group' && r.peer === 'G1', r)
T('带通道标记', r.channel === 'qq', r.channel)

// 新通道只注册 adapter，不改身份层
C.registerChannel({ id: 'web', name: 'Web', resolveSession: (id) => (String(id).startsWith('web-') ? { scope: 'c2c', peer: 'w1', peerKey: peerKey('c2c', 'w1') } : null) })
const w = C.resolveSession('web-abc')
T('注册新通道即可用', w && w.channel === 'web', w)
T('通道列表更新', C.listChannels().some((c) => c.id === 'web'))
T('sessionIdOfContext 通道无关', C.sessionIdOfContext({ session: { id: 'abcdefgh' } }) === 'abcdefgh')

console.log('=== P17 通道抽象测试 ===')
let fail = 0
for (const [n, p, d] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d))); if (!p) fail++ }
console.log(fail ? '失败 ' + fail : '全部通过')
try { rmSync(process.env.DSH_HOME, { recursive: true, force: true }) } catch {}
process.exit(fail ? 1 : 0)
