/**
 * 关系换档：不是每次 ±0.1 都记一条，只有跨档那一下才算「关系变了」。
 * 跨档后写一条 relation 判断进记忆，关系才参与成长。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-bond-'))
delete process.env.QQBOT_REFINE_HOME
const url = (p) => new URL(p, import.meta.url).href
const { ensureStore } = await import(url('../lib/config.js'))
const { ensureDirs } = await import(url('../lib/store.js'))
const B = await import(url('../lib/bond.js'))
ensureStore(); ensureDirs()

const ok = []
const T = (n, p, d) => ok.push([n, !!p, d])

T('0 档是普通', B.bondTier(0) === 'normal', B.bondTier(0))
T('2 档起算熟', B.bondTier(2) === 'close', B.bondTier(2))
T('6 档起很熟', B.bondTier(6) === 'vclose', B.bondTier(6))
T('-4 档别扭', B.bondTier(-4) === 'awkward', B.bondTier(-4))
T('1.5 还在普通档不跨', B.bondTier(1.5) === 'normal', B.bondTier(1.5))
T('1→2 跨档', B.bondTier(1) !== B.bondTier(2))
T('档位都有话可说', ['vclose', 'close', 'awkward', 'normal'].every((t) => B.bondTierText(t).length >= 2))

// 加 3 点从普通跨到「还算熟」
B.touchBond('g_bond', 'u_bond', { bond: 3 })
T('touchBond 后落到 close 档', B.bondTier(B.bondOf('g_bond', 'u_bond').bond) === 'close', B.bondOf('g_bond', 'u_bond'))
// 再到 7：继续换档
B.touchBond('g_bond', 'u_bond', { bond: 4 })
T('继续加能到 vclose', B.bondTier(B.bondOf('g_bond', 'u_bond').bond) === 'vclose', B.bondOf('g_bond', 'u_bond'))

console.log('=== 关系换档测试 ===')
let fail = 0
for (const [n, p, d] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d))); if (!p) fail++ }
console.log(fail ? '失败 ' + fail : '全部通过')
try { rmSync(process.env.DSH_HOME, { recursive: true, force: true }) } catch {}
process.exit(fail ? 1 : 0)
