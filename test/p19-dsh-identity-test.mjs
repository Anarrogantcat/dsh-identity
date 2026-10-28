/**
 * P19 DSH 身份系统定位测试：QQ 会话走 QQ 场景，其它 DSH 会话不套聊天机器人
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-p19-'))
delete process.env.QQBOT_REFINE_HOME
const url = (p) => new URL(p, import.meta.url).href
const I = await import(url('../lib/identity.js'))
const { ensureStore, clone, DEFAULTS, saveConfig } = await import(url('../lib/config.js'))
const { ensureDirs } = await import(url('../lib/store.js'))
ensureStore(); ensureDirs()
const { apply } = await import(url('../index.js'))
const ok = []
const T = (n, p, d) => ok.push([n, !!p, d])

// 纯函数层
const web = I.composeIdentity({ scope: 'web' })
const group = I.composeIdentity({ scope: 'group' })
T('web 会话不套 QQ 群场景', !web.text.includes('QQ 群里') && web.text.includes('DSH 会话'), web.text.slice(0, 80))
T('QQ 群场景仍是聊天话风', group.text.includes('QQ 群里'), group.text.slice(0, 80))
T('身份段预算仍受限', web.used <= 900 && group.used <= 900)

// 走 apply：未映射的 session 应拿到 web 场景，而不是 QQ
saveConfig(clone(DEFAULTS))
const sections = new Map()
const scope = {
  logger: { info() {}, warn() {}, error() {} },
  effect: (fn) => { const d = fn(); return typeof d === 'function' ? d : () => {} },
  webServer: { register: () => () => {} },
  systemPrompt: { section: (s) => { sections.set(s.name, s); return () => {} } },
}
const ctx = { logger: scope.logger, inject: (n, cb) => cb(scope), get: () => null, effect: (fn) => fn(), webServer: scope.webServer }
await apply(ctx, {})
await new Promise((r) => setTimeout(r, 400))
const txt = await sections.get('qqbot-refine:identity').text({ session: { id: 'unknown-session-123' } })
T('未映射会话 = DSH 会话场景', txt.includes('DSH 会话') || txt.includes('身份'), txt.slice(0, 80))
T('未映射会话不出现 QQ 群聊天约束', !txt.includes('QQ 群里'), txt.slice(0, 120))

console.log('=== P19 DSH 身份定位测试 ===')
let fail = 0
for (const [n, p, d] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d))); if (!p) fail++ }
console.log(fail ? '失败 ' + fail : '全部通过')
try { rmSync(process.env.DSH_HOME, { recursive: true, force: true }) } catch {}
process.exit(fail ? 1 : 0)
