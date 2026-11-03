/**
 * web 会话也要有日子过：攒够一段对话要补当天复盘，
 * 不然「我想弄明白的事」只有 QQ 那边才有，主人在这边聊永远等不到。
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-webref-'))
delete process.env.QQBOT_REFINE_HOME
const url = (p) => new URL(p, import.meta.url).href
const { ensureStore } = await import(url('../lib/config.js'))
const { ensureDirs } = await import(url('../lib/store.js'))
const { installSessionGrowth } = await import(url('../lib/webgrowth.js'))
const { loadReflection } = await import(url('../lib/reflection.js'))
const { dayStr } = await import(url('../lib/diary.js'))
ensureStore(); ensureDirs()

const ok = []
const T = (n, p, d) => ok.push([n, !!p, d])
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const llm = {
  stream: async function* () {
    yield { type: 'text-delta', text: '今天聊了不少，话有点多。\n节奏还行。\n有个事我没弄明白。' }
  },
}
const cfg = { memory: { enabled: true, judge: false } }
const handlers = []
const ctx = { on: (n, f) => { if (n === 'session/event') handlers.push(f) } }
installSessionGrowth(ctx, { getConfig: () => cfg, logger: { warn() {} }, getLlm: () => llm })

const sid = 'web-reflect-e2e'
for (let i = 0; i < 20; i++) {
  for (const h of handlers) h({ header: { id: sid } }, { type: 'user/message', seq: i + 1, data: { role: 'user', content: [{ type: 'text', text: '今天聊的第 ' + i + ' 句，随便说点什么好凑够条数' }] } })
}
await sleep(600)

const pk = 'web_' + sid
const r = loadReflection(pk, dayStr())
T('web 会话攒够 20 条会补当天复盘', !!r && Array.isArray(r.lines) && r.lines.length >= 1, r)
T('复盘落了盘', existsSync(join(process.env.DSH_HOME, 'storages', 'dsh-qqbot-refine', 'reflections')) || !!r, r)

// 再发 20 条，同一天不该重复复盘
const before = r?.at
for (let i = 0; i < 20; i++) {
  for (const h of handlers) h({ header: { id: sid } }, { type: 'user/message', seq: 100 + i, data: { role: 'user', content: [{ type: 'text', text: '又聊了一轮第 ' + i + ' 句，还是凑条数' }] } })
}
await sleep(600)
const r2 = loadReflection(pk, dayStr())
T('同一天不重复复盘', r2?.at === before, { before, after: r2?.at })

console.log('=== web 复盘测试 ===')
let fail = 0
for (const [n, p, d] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d))); if (!p) fail++ }
console.log(fail ? '失败 ' + fail : '全部通过')
try { rmSync(process.env.DSH_HOME, { recursive: true, force: true }) } catch {}
process.exit(fail ? 1 : 0)
