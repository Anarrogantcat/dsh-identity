/**
 * 时间感：它得知道自己现在是下午还是深夜。
 * 人说话是分时段的，机器人才什么时候都一个样。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-time-'))
delete process.env.QQBOT_REFINE_HOME
const url = (p) => new URL(p, import.meta.url).href
const { ensureStore } = await import(url('../lib/config.js'))
const { ensureDirs } = await import(url('../lib/store.js'))
const { buildSelfModel } = await import(url('../lib/selfmodel.js'))
ensureStore(); ensureDirs()

const ok = []
const T = (n, p, d) => ok.push([n, !!p, d])

const text = buildSelfModel().text
T('自我模型里有时间行', /时间：现在是/.test(text), text.slice(0, 300))
T('时间行带时段词', /(凌晨|早上|上午|中午|下午|晚上|深夜)/.test(text), text.match(/时间：现在是[^\n]*/)?.[0])
T('时间行带钟点', /时间：现在是[^\n]*?\d+ 点/.test(text), text.match(/时间：现在是[^\n]*/)?.[0])

console.log('=== 时间感测试 ===')
let fail = 0
for (const [n, p, d] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d))); if (!p) fail++ }
console.log(fail ? '失败 ' + fail : '全部通过')
try { rmSync(process.env.DSH_HOME, { recursive: true, force: true }) } catch {}
process.exit(fail ? 1 : 0)
