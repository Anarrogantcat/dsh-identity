/**
 * P18 成长指标测试：稳定认知 / 矛盾率 / 兑现率 / 情绪 / 周月汇总（只读）
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-p18-'))
delete process.env.QQBOT_REFINE_HOME
const url = (p) => new URL(p, import.meta.url).href
const { ensureStore } = await import(url('../lib/config.js'))
const { ensureDirs, peerKey } = await import(url('../lib/store.js'))
ensureStore(); ensureDirs()
const G = await import(url('../lib/growth.js'))
const T = await import(url('../lib/traits.js'))
const P = await import(url('../lib/promises.js'))
const ok = []
const Tt = (n, p, d) => ok.push([n, !!p, d])
const PK = peerKey('group', 'G1')
const day = (n) => new Date(Date.now() - n * 86400000).toISOString()

// 跨两天的 3 次证据 → durable
for (const [i, d] of [2, 1, 0].entries()) T.observe('喜欢被叫本鱼', { ref: 'e' + i, at: day(d) })
T.observe('今天有点累', { ref: 'm', kind: 'feeling', at: day(1) })
P.notePromise(PK, '等下帮你查版本号')
P.notePromise(PK, '明天陪你练一局')
P.closePromise(P.listPromises({}).find((x) => x.text.includes('查版本号')).id, 'done')
P.notePromise(PK, '回头帮你写作业', { at: day(5) })

const m = G.growthMetrics(PK)
Tt('durable 计入', m.traits.durable >= 1, m.traits)
Tt('tentative 计入', m.traits.tentative >= 1, m.traits)
Tt('矛盾率是数字', Number.isFinite(m.traits.conflictRate))
Tt('兑现率可算', m.promises.done >= 1 && m.promises.fulfillRate > 0, m.promises)
Tt('逾期被统计', m.promises.overdue >= 1, m.promises)
Tt('月复盘可汇总', m.month && Number.isFinite(m.month.days), m.month)
Tt('空 peer 不炸', (() => { const g = G.growthMetrics(''); return g && g.traits.total >= 0 })())

console.log('=== P18 成长指标测试 ===')
let fail = 0
for (const [n, p, d] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d))); if (!p) fail++ }
console.log(fail ? '失败 ' + fail : '全部通过')
try { rmSync(process.env.DSH_HOME, { recursive: true, force: true }) } catch {}
process.exit(fail ? 1 : 0)
