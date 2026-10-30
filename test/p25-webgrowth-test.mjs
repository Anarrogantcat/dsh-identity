/**
 * P25 web 会话成长：官方 ctx.on('session/event') 接入，QQ 会话不重复记
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-p25-'))
delete process.env.QQBOT_REFINE_HOME
const url = (p) => new URL(p, import.meta.url).href
const { ensureStore } = await import(url('../lib/config.js'))
const { ensureDirs, peerKey } = await import(url('../lib/store.js'))
const E = await import(url('../lib/events.js'))
const M = await import(url('../lib/memory.js'))
const { installSessionGrowth } = await import(url('../lib/webgrowth.js'))
await import(url('../lib/channel-qq.js'))
const { rememberSession } = await import(url('../lib/persona.js'))
ensureStore(); ensureDirs()
const ok = []
const T = (n, p, d) => ok.push([n, !!p, d])
let handler = null
const installed = installSessionGrowth({ on: (name, fn) => { handler = fn } }, { getConfig: () => ({ memory: { enabled: true } }) })
T('能挂到宿主 session/event', installed === true && typeof handler === 'function')

const sid = 'web-sess-1'
handler({ header: { id: sid } }, { type: 'user/message', seq: 1, data: { message: { content: [{ type: 'text', text: '今天在 DSH 里调代码' }] } } })
const pk = 'web_' + sid
T('web 用户消息落事件', E.readEvents(pk).length === 1, E.readEvents(pk))
T('web 用户消息进记忆', M.listMemory(pk).length === 1)
const card = M.memoryCard(pk, {})
T('web 记忆能被注入召回', card.includes('今天在 DSH 里调代码'), card)
handler({ header: { id: sid } }, { type: 'assistant/message', seq: 2, data: { message: { content: [{ type: 'text', text: '那就先跑测试' }] } } })
T('她的回复也落事件', E.readEvents(pk).some((e) => e.origin === 'bot'))

const qsid = 'qq-sess-1'
rememberSession(qsid, peerKey('group', 'G1'), 'group', 'G1')
handler({ header: { id: qsid } }, { type: 'user/message', seq: 1, data: { message: { content: [{ type: 'text', text: 'QQ 消息' }] } } })
T('QQ 会话不重复记', E.readEvents(peerKey('group', 'G1')).length === 0)
T('无 on 的宿主不报错', installSessionGrowth({}, {}) === false)

console.log('=== P25 web 成长测试 ===')
let fail = 0
for (const [n, p, d] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d))); if (!p) fail++ }
console.log(fail ? '失败 ' + fail : '全部通过')
try { rmSync(process.env.DSH_HOME, { recursive: true, force: true }) } catch {}
process.exit(fail ? 1 : 0)
