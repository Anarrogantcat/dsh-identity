/**
 * 惦记的事要能进 web 会话的上下文：它没有主动开口那条腿，
 * 只能靠每次说话时把「我还没弄明白的」带进来，不然永远想不起来问。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-due-'))
delete process.env.QQBOT_REFINE_HOME
const url = (p) => new URL(p, import.meta.url).href
const { ensureStore } = await import(url('../lib/config.js'))
const { ensureDirs } = await import(url('../lib/store.js'))
const { noteOpen } = await import(url('../lib/open-topics.js'))
const I = await import(url('../index.js'))
ensureStore(); ensureDirs()

const ok = []
const T = (n, p, d) => ok.push([n, !!p, d])

const sid = 'due-inject-test'
const pk = 'web_' + sid
const HOUR = 3600000
noteOpen(pk, '为什么精力总是不生效', Date.now() - 21 * HOUR)

const s1 = I.memorySectionText({ session: { id: sid } })
T('过了 20 小时的惦记会进上下文', s1.includes('惦记') && s1.includes('精力'), s1.slice(0, 300))

const s2 = I.memorySectionText({ session: { id: sid } })
T('同一条只提醒一次（问过就不再挂）', !s2.includes('惦记'), s2.slice(0, 200))

// 没到 20 小时的先不打扰
noteOpen(pk, '刚想到的事，还不到时候问', Date.now())
const s3 = I.memorySectionText({ session: { id: sid } })
T('不到 20 小时不催', !s3.includes('刚想到的事'), s3.slice(0, 200))

console.log('=== 惦记的事注入测试 ===')
let fail = 0
for (const [n, p, d] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d))); if (!p) fail++ }
console.log(fail ? '失败 ' + fail : '全部通过')
try { rmSync(process.env.DSH_HOME, { recursive: true, force: true }) } catch {}
process.exit(fail ? 1 : 0)
