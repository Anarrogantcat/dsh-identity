/**
 * 成长指标要能看出「记事」和「精力」这两条新链：
 * judgments = 她对这个人的判断数（origin=agent 的结论），不是原话条数。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-growth-'))
delete process.env.QQBOT_REFINE_HOME
const url = (p) => new URL(p, import.meta.url).href
const { ensureStore } = await import(url('../lib/config.js'))
const { ensureDirs, dirs, writeJson } = await import(url('../lib/store.js'))
const { addMemory } = await import(url('../lib/memory.js'))
const { growthMetrics } = await import(url('../lib/growth.js'))
ensureStore(); ensureDirs()

const ok = []
const T = (n, p, d) => ok.push([n, !!p, d])
const PK = 'web_growth-test'

// 原话：不算判断
addMemory(PK, { text: '感觉精力没生效', category: 'event', importance: 0.3, source: 'web', origin: 'user' })
// 判断：算
addMemory(PK, { text: '主人很在意精力是不是真的生效，不只是有个百分比', category: 'preference', importance: 0.7, source: 'judge', origin: 'agent' })
addMemory(PK, { text: '主人说话直接，不喜欢绕弯', category: 'relation', importance: 0.6, source: 'judge', origin: 'agent' })

const day = (() => { const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate() })()
writeJson(join(dirs.root, 'pace.json'), { energy: 0.2, at: new Date().toISOString(), stamps: [], streak: 3, tired: 3, tiredDay: day })

const g = growthMetrics(PK)
T('判断卡单独计数', g.judgments === 2, g.judgments)
T('原话不算判断', !String(g.judgments).includes('1'), g.judgments)
T('成长指标带精力强度', g.energy && typeof g.energy.energy === 'number', g.energy)
T('成长指标带硬撑次数', g.energy?.tired === 3, g.energy)
T('成长指标带 tone', g.energy?.tone === 'low', g.energy)

console.log('=== 成长指标测试 ===')
let fail = 0
for (const [n, p, d] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d))); if (!p) fail++ }
console.log(fail ? '失败 ' + fail : '全部通过')
try { rmSync(process.env.DSH_HOME, { recursive: true, force: true }) } catch {}
process.exit(fail ? 1 : 0)
