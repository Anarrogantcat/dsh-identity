/**
 * web 会话记忆注入：写入桶 web_<sid> 与注入读取必须一致，
 * 且不能串到别的会话。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-webmem-'))
delete process.env.QQBOT_REFINE_HOME
const url = (p) => new URL(p, import.meta.url).href
const { ensureStore, loadConfig } = await import(url('../lib/config.js'))
const { ensureDirs } = await import(url('../lib/store.js'))
const M = await import(url('../lib/memory.js'))
const I = await import(url('../index.js'))
ensureStore(); ensureDirs()

const sid = 'web-inject-sess-1'
const cfg = loadConfig()
M.addMemory('web_' + sid, { text: '用户说过他喜欢喝冰美式', category: 'event', importance: 0.6, source: 'web' }, cfg)
const got = I.memorySectionText({ session: { id: sid } })
const other = I.memorySectionText({ session: { id: 'web-other-sess-2' } })

const ok = []
const T = (n, p, d) => ok.push([n, !!p, d])
T('web 会话能注入自己的记忆', got.includes('冰美式'), got)
T('别的 web 会话不串记忆', !other.includes('冰美式'), other)
T('没有 sid 时不炸', typeof I.memorySectionText({}) === 'string')

console.log('=== web 记忆注入测试 ===')
let fail = 0
for (const [n, p, d] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d))); if (!p) fail++ }
console.log(fail ? '失败 ' + fail : '全部通过')
try { rmSync(process.env.DSH_HOME, { recursive: true, force: true }) } catch {}
process.exit(fail ? 1 : 0)
