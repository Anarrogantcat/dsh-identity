/**
 * web 会话的共情链路。
 *
 * 以前 empathy 只在 QQ 通道里记和用：群里有人难受会被接住，私下（DSH web）聊反而
 * 完全读不到情绪——「会共情别人」只在一个通道成立。这里守三件事：
 *   1) web 会话说情绪话 → 记一条共情事件（peer = web_<sid>）
 *   2) 下一轮上下文里带出共情提示（只影响怎么说，不抽台词）
 *   3) 别的会话不串；下一句能改判上一条的 outcome
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-webemp-'))
delete process.env.QQBOT_REFINE_HOME

const url = (p) => new URL(p, import.meta.url).href
const { ensureStore, loadConfig } = await import(url('../lib/config.js'))
const { ensureDirs } = await import(url('../lib/store.js'))
const W = await import(url('../lib/webgrowth.js'))
const E = await import(url('../lib/empathy.js'))
const I = await import(url('../index.js'))
ensureStore(); ensureDirs()

const ok = []
const T = (n, p, d) => ok.push([n, !!p, d])

const sid = 'session-empathy-test-1'
const cfg = loadConfig()
const handlers = {}
W.installSessionGrowth({ on(ev, fn) { handlers[ev] = fn } }, { getConfig: () => cfg, logger: console, getLlm: () => null })
T('装上了 session/event 钩子', typeof handlers['session/event'] === 'function')

let seq = 0
const fire = (text) => handlers['session/event']({ header: { id: sid } }, {
  type: 'user/message',
  seq: ++seq,
  data: { role: 'user', content: [{ type: 'text', text }] },
})

fire('今天被老板骂了，很难过，有点想哭')
const rec = E.recent(10).filter((x) => x.peer === 'web_' + sid)
T('web 会话会记共情', rec.length === 1 && rec[0].emotion === '难过', rec)
T('共情带策略', !!rec[0]?.guide || !!rec[0]?.strategy, rec[0])

const sec = I.memorySectionText({ session: { id: sid } })
T('共情提示进上下文', sec.includes('共情提示'), sec)
const other = I.memorySectionText({ session: { id: 'session-someone-else' } })
T('别的会话不串共情', !other.includes('共情提示'), other)

fire('别安慰我，烦')
const rec2 = E.recent(10).filter((x) => x.peer === 'web_' + sid)
T('下一句给上一条记结果', rec2.some((x) => x.outcome === 'negative'), rec2.map((x) => x.outcome))
T('这次的情绪也记下了', rec2.length >= 2, rec2.length)

console.log('=== web 共情测试 ===')
let fail = 0
for (const [n, p, d] of ok) {
  console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d)))
  if (!p) fail++
}
console.log(fail ? `失败 ${fail}` : '全部通过')
try { rmSync(process.env.DSH_HOME, { recursive: true, force: true }) } catch { /* ignore */ }
process.exit(fail ? 1 : 0)
