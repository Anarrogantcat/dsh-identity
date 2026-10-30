/**
 * 记忆容量：只算「活着的」条目；改口作废的单独限量保留，不挤占正式容量
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOME = mkdtempSync(join(tmpdir(), 'dsh-memcap-'))
process.env.DSH_HOME = HOME
delete process.env.QQBOT_REFINE_HOME

const url = (p) => new URL(p, import.meta.url).href
const M = await import(url('../lib/memory.js'))
const { ensureStore, clone, DEFAULTS } = await import(url('../lib/config.js'))
const { ensureDirs, peerKey } = await import(url('../lib/store.js'))
ensureStore(); ensureDirs()

const ok = []
const A = (n, p, d) => ok.push([n, !!p, d])
const PK = peerKey('group', 'G1')
const cfg = clone(DEFAULTS)
cfg.memory.maxPerPeer = 10
cfg.memory.supersededKeep = 3

const live = () => M.listMemory(PK).filter((i) => i.status !== 'superseded')
const dead = () => M.listMemory(PK).filter((i) => i.status === 'superseded')

// 填满 10 条活的
for (let i = 0; i < 10; i++) M.addMemory(PK, { text: '事实' + i, importance: 0.5, origin: 'user' }, cfg)
A('容量到 10 就不涨了', live().length === 10, live().length)

// 改口 6 次：每次作废一条、新增一条，活的数量不变，作废的只留 3 条
for (let i = 0; i < 6; i++) {
  const r = M.correctMemory(PK, { keyword: '事实' + i, text: '事实' + i + '改口', cfg })
  if (!r.ok) A('改口第 ' + i + ' 次失败', false, r)
}
A('活着的仍是 10 条（作废不占容量）', live().length === 10, live().length)
A('作废只留 3 条', dead().length === 3, dead().length)
A('总数 = 10 活 + 3 作废', M.listMemory(PK).length === 13, M.listMemory(PK).length)

// 继续写新记忆，作废的不会被当成"活容量"挤掉新的
for (let i = 0; i < 3; i++) M.addMemory(PK, { text: '新事实' + i, importance: 0.6, origin: 'user' }, cfg)
A('新记忆能进来，活的仍 ≤10', live().length === 10, live().length)
A('作废的还在（3 条）', dead().length === 3, dead().length)

// 水位审计按"活的"算
{
  const { readFileSync, existsSync } = await import('node:fs')
  const { dirs } = await import(url('../lib/store.js'))
  const ap = join(dirs.logs, 'audit.jsonl')
  const txt = existsSync(ap) ? readFileSync(ap, 'utf8') : ''
  const m = [...txt.matchAll(/"kind":"memory\.watermark"[^\n]*"used":(\d+)/g)].map((x) => Number(x[1]))
  A('水位按活条数报（不超过 10）', m.length > 0 && m.every((n) => n <= 10), m.slice(-3))
}

console.log('=== 记忆容量（活/作废分开算）测试 ===')
let fail = 0
for (const [n, p, d] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d))); if (!p) fail++ }
console.log(fail ? `失败 ${fail}` : '全部通过')
try { rmSync(HOME, { recursive: true, force: true }) } catch { /* ignore */ }
process.exitCode = fail ? 1 : 0
