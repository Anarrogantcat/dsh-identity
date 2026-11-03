/**
 * traits 合并：同一条认知换个说法要并到同一件上，
 * 否则证据永远跨不过两天，durable 永远长不出来。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-traits-'))
delete process.env.QQBOT_REFINE_HOME
const url = (p) => new URL(p, import.meta.url).href
const { ensureStore } = await import(url('../lib/config.js'))
const { ensureDirs } = await import(url('../lib/store.js'))
const T = await import(url('../lib/traits.js'))
ensureStore(); ensureDirs()

const ok = []
const A = (n, p, d) => ok.push([n, !!p, d])
const count = () => T.listTraits({ limit: 500 }).length
const find = (t) => T.listTraits({ limit: 500 }).find((x) => x.text === t)

// 1) 标点/空白不同不算新的一条
const r1 = T.observe('我说话前先看上下文再答', { ref: 'a1', kind: 'feedback' })
const r2 = T.observe('我说话前先看上下文再答。', { ref: 'a2', kind: 'feedback' })
A('标点不同合并到同一条', r1.created === true && r2.created === false && r2.id === r1.id, { r1, r2 })
A('合并后证据累加', (find('我说话前先看上下文再答')?.hits ?? 0) === 2, find('我说话前先看上下文再答')?.hits)

// 2) 换个说法也算同一件
const before = count()
const r3 = T.observe('我说话前先看上下文再回答', { ref: 'a3', kind: 'feedback' })
A('相似说法不新开一条', r3.created === false && count() === before, { created: r3.created, before, now: count() })

// 3) 否定相反不合并
const n1 = T.observe('我记得别人说过的话', { ref: 'b1', kind: 'feedback' })
const n2 = T.observe('我不记得别人说过的话', { ref: 'b2', kind: 'feedback' })
A('否定相反不合并', n1.created === true && n2.created === true && n1.id !== n2.id, { n1, n2 })

// 4) 跨三天累积能升 durable
const d3 = new Date(Date.now() - 3 * 86400000).toISOString()
const d2 = new Date(Date.now() - 2 * 86400000).toISOString()
const d1 = new Date(Date.now() - 1 * 86400000).toISOString()
T.observe('被指出理解错时先看上下文再答', { ref: 'c1', kind: 'feedback', at: d3 })
T.observe('被指出理解错时先看上下文再答', { ref: 'c2', kind: 'feedback', at: d2 })
const r4 = T.observe('被指出理解错时先看上下文再答', { ref: 'c3', kind: 'feedback', at: d1 })
A('跨三天三次证据升 durable', r4.status === 'durable', r4)

// 5) 只有 durable 才进出口吻的 bias
const bias = T.behaviorBias()
A('behaviorBias 只认 durable', bias.durable >= 1, bias)

// 6) 单次证据不会 durable
T.observe('我只是今天随便说说', { ref: 'e1', kind: 'feedback' })
A('单次证据只到 tentative', find('我只是今天随便说说')?.status === 'tentative', find('我只是今天随便说说')?.status)

console.log('=== traits 合并测试 ===')
let fail = 0
for (const [n, p, d] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d))); if (!p) fail++ }
console.log(fail ? '失败 ' + fail : '全部通过')
try { rmSync(process.env.DSH_HOME, { recursive: true, force: true }) } catch {}
process.exit(fail ? 1 : 0)
