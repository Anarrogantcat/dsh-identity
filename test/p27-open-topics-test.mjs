/**
 * P27 没聊完的话题：持久化、去重、到期、标记已问
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-p27-'))
delete process.env.QQBOT_REFINE_HOME
const url = (p) => new URL(p, import.meta.url).href
const { ensureStore } = await import(url('../lib/config.js'))
const { ensureDirs } = await import(url('../lib/store.js'))
ensureStore(); ensureDirs()
const T = await import(url('../lib/open-topics.js'))
const ok = []
const A = (n, p, d) => ok.push([n, !!p, d])
const pk = 'g_test'
const now = Date.now()
A('记一条', T.noteOpen(pk, '明天那个生图的事还没弄完', now).ok === true)
A('重复不堆', T.noteOpen(pk, '明天那个生图的事还没弄完', now + 60000).dup === true)
A('未到时间不追', T.dueOpen(pk, 20, now + 3600000) === null)
const due = T.dueOpen(pk, 20, now + 21 * 3600000)
A('放够 20 小时才追', !!due && String(due.text).includes('生图'))
T.markAsked(pk, due.id)
A('标记后不再追', T.dueOpen(pk, 20, now + 22 * 3600000) === null)
T.noteOpen(pk, '过期的话题内容', now - 8 * 86400000)
A('7 天过期', T.prune(now) >= 1)
console.log('=== P27 话题跟进测试 ===')
let fail = 0
for (const [n, p, d] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d))); if (!p) fail++ }
console.log(fail ? '失败 ' + fail : '全部通过')
try { rmSync(process.env.DSH_HOME, { recursive: true, force: true }) } catch {}
process.exit(fail ? 1 : 0)
