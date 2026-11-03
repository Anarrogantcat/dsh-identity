/**
 * 七情六欲规则（常态验收，进 npm test）
 *
 * scripts/mood-acceptance.mjs 是给人看的模拟曲线；这里把同样的口径压成断言，
 * 守住五条：累积有上限 / 24h 落一半 / 负面比正面久 / 抗拒档明说别骂人 / 道歉降三成。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-moodrules-'))
delete process.env.QQBOT_REFINE_HOME

const url = (p) => new URL(p, import.meta.url).href
const M = await import(url('../lib/moodv2.js'))
const { ensureStore } = await import(url('../lib/config.js'))
const { ensureDirs } = await import(url('../lib/store.js'))
ensureStore()
ensureDirs()

const ok = []
const T = (n, p, d) => ok.push([n, !!p, d])
const MIN = 60000
const HOUR = 3600000
const T0 = Date.UTC(2026, 10, 3, 4, 0, 0)
const anger = (now) => Number(M.getState(now).seven.anger || 0)

M.reset()
const base = anger(T0)
M.note('滚，闭嘴', { role: 'member', now: T0 })
const a1 = anger(T0)
M.note('你真烦', { role: 'member', now: T0 + MIN })
const a2 = anger(T0 + MIN)
M.note('傻了吧', { role: 'member', now: T0 + 2 * MIN })
const a3 = anger(T0 + 2 * MIN)

T('第一次不会炸', a1 - base <= 0.2, { base, a1 })
T('连着怼会累积', a2 > a1 && a3 > a2, { a1, a2, a3 })
T('累积有上限', a3 <= 0.95, a3)

const peak = a3 - base
const a24 = anger(T0 + 24 * HOUR) - base
T('24h 回落一半', a24 <= peak * 0.52, { peak, a24, retain: a24 / peak })

M.reset()
const joyBase = Number(M.getState(T0).seven.joy || 0)
for (let i = 0; i < 3; i++) M.note('哈哈 好耶 太棒了', { role: 'member', now: T0 + i * MIN })
const joyPeak = Number(M.getState(T0 + 2 * MIN).seven.joy || 0) - joyBase
const joy24 = Number(M.getState(T0 + 24 * HOUR).seven.joy || 0) - joyBase
T('负面留得比正面久', (a24 / peak) > (joyPeak > 0 ? joy24 / joyPeak : 0), { anger: a24 / peak, joy: joyPeak ? joy24 / joyPeak : 0 })

M.reset()
for (let i = 0; i < 3; i++) M.note('滚 烦死了', { role: 'member', now: T0 + i * MIN })
const st = M.getState(T0 + 3 * MIN)
T('气到一定程度进抗拒档', M.blendsOf(st).some((b) => b.label === '抗拒'), M.blendsOf(st))
T('抗拒档允许嘴毒但有边界', /脏话|人身攻击/.test(M.toneBlock(st)))

const before = anger(T0 + 3 * MIN)
M.note('对不起，是我错了', { role: 'member', now: T0 + 4 * MIN })
const after = anger(T0 + 4 * MIN)
const pct = before > base ? (before - after) / (before - base) : 0
T('道歉降火约三成', pct >= 0.2 && pct <= 0.45, { before, after, pct })
T('但不清零', after > base + 0.01, { after, base })

console.log('=== 七情六欲规则 测试 ===')
let fail = 0
for (const [n, p, d] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d))); if (!p) fail++ }
console.log(fail ? `失败 ${fail}` : '全部通过')
try { rmSync(process.env.DSH_HOME, { recursive: true, force: true }) } catch { /* ignore */ }
process.exitCode = fail ? 1 : 0
