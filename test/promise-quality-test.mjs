/**
 * 承诺池要干净：只有她真的答应了什么才记。
 * 以前含「记得」就记，结果反问句、提醒别人的话全成了承诺挂着。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-pq-'))
delete process.env.QQBOT_REFINE_HOME
const url = (p) => new URL(p, import.meta.url).href
const { ensureStore } = await import(url('../lib/config.js'))
const { ensureDirs, peerKey } = await import(url('../lib/store.js'))
const P = await import(url('../lib/promises.js'))
ensureStore(); ensureDirs()

const ok = []
const T = (n, p, d) => ok.push([n, !!p, d])
const PK = peerKey('group', 'G-PROMISE')

// 真承诺
T('「等下我帮你查一下版本号」记', P.notePromise(PK, '等下我帮你查一下版本号').ok === true)
T('「明天陪你练一局」记', P.notePromise(PK, '明天陪你练一局').ok === true)
T('「我回头查一下」记', P.notePromise(PK, '我回头查一下').ok === true)

// 假承诺（真实数据里混进来的脏东西）
T('「谁还记得刚才在聊什么词条」不记', P.notePromise(PK, '这一身花嫁一出来，谁还记得刚才在聊什么词条').ok === false)
T('「记得别再往下挖」不记', P.notePromise(PK, '这循环挺妙，第二杯记得别再往下挖').ok === false)
T('问句不记', P.notePromise(PK, '你明天来吗？').ok === false)
T('闲聊不记', P.notePromise(PK, '今天天气不错').ok === false)

// 幂等
const dup = P.notePromise(PK, '等下我帮你查一下版本号')
T('同句幂等', dup.dup === true)

// 池子里只有 3 条真承诺
const open = P.listPromises({ status: 'open', peerKey: PK })
T('池子里没有脏承诺', open.length === 3 && open.every((x) => !/谁|记得别|吗/.test(x.text)), open.map((x) => x.text))

console.log('=== 承诺质量测试 ===')
let fail = 0
for (const [n, p, d] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d))); if (!p) fail++ }
console.log(fail ? '失败 ' + fail : '全部通过')
try { rmSync(process.env.DSH_HOME, { recursive: true, force: true }) } catch {}
process.exit(fail ? 1 : 0)
