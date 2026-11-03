#!/usr/bin/env node
/**
 * 七情六欲 · 模拟验收（不碰真实心情数据）
 *
 *   node scripts/mood-acceptance.mjs
 *
 * 按「正常人」的五条规则跑曲线：
 *   1. 一次不会炸，但会累积；有上限，不会无限升级
 *   2. 没新刺激 24 小时回落一半以上
 *   3. 负面比正面留得久
 *   4. 烦了会表现在话上（抗拒档），但提示里明说别骂人
 *   5. 道歉能降火三成左右
 *
 * 全部用显式时间戳推进，不依赖真实时钟。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-mood-'))
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
const joy = (now) => Number(M.getState(now).seven.joy || 0)

M.reset()
const base = anger(T0)

// ── 1. 连怼三次：累积、但有上限 ──
M.note('滚，闭嘴', { role: 'member', now: T0 })
const a1 = anger(T0)
M.note('你真烦', { role: 'member', now: T0 + 1 * MIN })
const a2 = anger(T0 + 1 * MIN)
M.note('傻了吧', { role: 'member', now: T0 + 2 * MIN })
const a3 = anger(T0 + 2 * MIN)

T('第一次不会炸（还在基线附近）', a1 - base <= 0.2, { base, a1 })
T('连着怼会累积', a2 > a1 && a3 > a2, { a1, a2, a3 })
T('累积有上限（不会无限升级）', a3 <= 0.95, { a3 })

// ── 2. 24 小时没新刺激：回落一半以上 ──
const peak = a3 - base
const a24 = anger(T0 + 24 * HOUR) - base
T('24 小时回落 ≥50%', a24 <= peak * 0.52, { peak: +peak.toFixed(3), a24: +a24.toFixed(3), retain: +(a24 / peak).toFixed(2) })

// ── 3. 负面比正面留得久 ──
M.reset()
const joyBase = joy(T0)
for (let i = 0; i < 3; i++) M.note('哈哈 好耶 太棒了', { role: 'member', now: T0 + i * MIN })
const joyPeak = joy(T0 + 2 * MIN) - joyBase
const joy24 = joy(T0 + 24 * HOUR) - joyBase
const joyRetain = joyPeak > 0 ? joy24 / joyPeak : 0
const angerRetain = peak > 0 ? a24 / peak : 0
T('负面留得比正面久', angerRetain > joyRetain, { angerRetain: +angerRetain.toFixed(2), joyRetain: +joyRetain.toFixed(2) })

// ── 4. 烦了会表现在话上，但提示里明说别骂人 ──
M.reset()
for (let i = 0; i < 3; i++) M.note('滚 烦死了', { role: 'member', now: T0 + i * MIN })
const st = M.getState(T0 + 3 * MIN)
const blends = M.blendsOf(st).map((b) => b.label)
const block = M.toneBlock(st)
T('气到一定程度会进「抗拒」档', blends.includes('抗拒'), blends)
T('语气块里带着这句话', /别骂人/.test(block), block.slice(0, 60))

// ── 5. 道歉降火三成 ──
M.reset()
for (let i = 0; i < 3; i++) M.note('滚 烦死了', { role: 'member', now: T0 + i * MIN })
const before = anger(T0 + 3 * MIN)
M.note('对不起，是我错了', { role: 'member', now: T0 + 4 * MIN })
const after = anger(T0 + 4 * MIN)
const drop = before - after
const pct = before > 0 ? drop / (before - base) : 0
T('道歉真的降火（约三成）', pct >= 0.2 && pct <= 0.45, { before: +before.toFixed(2), after: +after.toFixed(2), pct: +pct.toFixed(2) })
T('但不会一下清零', after > base + 0.01, { after, base })

// ── 曲线打印 ──
console.log('=== 七情六欲 · 情绪曲线 ===')
console.log(`基线 anger=${base.toFixed(2)}`)
console.log('连怼三次：' + [a1, a2, a3].map((x) => x.toFixed(2)).join(' → '))
console.log(`24h 后：${(a24 + base).toFixed(2)}（残留 ${(angerRetain * 100).toFixed(0)}%；正面残留 ${(joyRetain * 100).toFixed(0)}%）`)
console.log(`道歉前 ${before.toFixed(2)} → 道歉后 ${after.toFixed(2)}（降 ${(pct * 100).toFixed(0)}%）`)
console.log('')

console.log('=== 七情六欲 · 模拟验收 ===')
let fail = 0
for (const [n, p, d] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d))); if (!p) fail++ }
console.log(fail ? `失败 ${fail}` : '全部通过')
try { rmSync(process.env.DSH_HOME, { recursive: true, force: true }) } catch { /* ignore */ }
process.exitCode = fail ? 1 : 0
