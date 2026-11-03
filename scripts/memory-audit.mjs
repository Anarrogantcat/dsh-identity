#!/usr/bin/env node
/**
 * 记忆层体检（只读）：回答两个问题，别拍脑袋改衰减曲线。
 *
 *   node scripts/memory-audit.mjs
 *
 * 1. 衰减：有多少高置信（≥0.85）记忆已经老到该沉底了？它们现在会不会被 injectFloor 挡掉？
 *    —— 没有 ≥30 天的样本，就别动 high 不衰减那套参数。
 * 2. 晋升：tentative 里有多少「证据已经够 3 次、却还是 tentative」的？
 *    它们卡住的原因是不是同一类碎句（口头禅/承诺）在重复凑数？
 */
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { listMemory, confidenceOf } from '../lib/memory.js'
import { readJson, dirs } from '../lib/store.js'
import { evidenceStats, recompute } from '../lib/lifecycle.js'

const DAY = 86400000
const now = Date.now()
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0)

// ── 一、记忆衰减 ──
const rows = []
for (const f of readdirSync(join(dirs.root, 'memory'))) {
  if (!f.endsWith('.json') || f.endsWith('.full.json')) continue
  const pk = f.replace(/\.json$/, '')
  for (const m of listMemory(pk)) {
    if (m.status !== 'active') continue
    rows.push({ pk, ...m, conf: confidenceOf({ origin: m.origin, confidence: m.confidence }), ageDays: (now - Date.parse(m.at)) / DAY })
  }
}
const high = rows.filter((r) => r.conf >= 0.85)
const aged = high.filter((r) => r.ageDays >= 30)
const dropped = aged.filter((r) => r.P < 0.2)

console.log('=== 记忆置信度 / 衰减 ===')
console.log(`活跃记忆 ${rows.length}｜高置信(≥0.85) ${high.length}｜其中 ≥30 天 ${aged.length}｜会被 floor 挡掉 ${dropped.length}`)
const buckets = { '<7天': 0, '7-30天': 0, '30-90天': 0, '>90天': 0 }
for (const r of high) {
  if (r.ageDays < 7) buckets['<7天']++
  else if (r.ageDays < 30) buckets['7-30天']++
  else if (r.ageDays < 90) buckets['30-90天']++
  else buckets['>90天']++
}
console.log('高置信按年龄：' + Object.entries(buckets).map(([k, v]) => `${k}=${v}`).join('  '))
if (!aged.length) {
  console.log('结论：还没有 ≥30 天的高置信样本，**现在不该改「high 不衰减」的曲线**——没有数据支撑。')
} else {
  console.log(`结论：${aged.length} 条高置信老记忆里 ${dropped.length} 条（${pct(dropped.length, aged.length)}%）低于 injectFloor，值得考虑给高置信加豁免。`)
}

// ── 二、traits 晋升停滞 ──
const t = readJson(join(dirs.root, 'traits.json'), { items: {} })
const items = Object.values(t.items || {})
const byStatus = {}
for (const x of items) byStatus[x.status] = (byStatus[x.status] || 0) + 1

const tent = items.filter((x) => x.status === 'tentative')
const stuck = tent.filter((x) => {
  const s = evidenceStats(x.evidence || [], now)
  return s.hits >= 3 && !s.moodOnly
})
const kindCount = {}
for (const x of stuck) kindCount[x.kind || '(空)'] = (kindCount[x.kind || '(空)'] ?? 0) + 1
const promoteAble = stuck.filter((x) => recompute(x, now).status === 'durable').length

console.log('')
console.log('=== traits 晋升 ===')
console.log('状态：' + Object.entries(byStatus).map(([k, v]) => `${k}=${v}`).join('  '))
console.log(`tentative ${tent.length}｜证据够 3 次却还卡着 ${stuck.length}（重算会升 ${promoteAble}）`)
if (stuck.length) {
  console.log('卡住的按 kind：' + Object.entries(kindCount).map(([k, v]) => `${k}=${v}`).join('  '))
  for (const x of stuck.slice(0, 6)) {
    const s = evidenceStats(x.evidence || [], now)
    console.log(`  · [${x.kind}] 证据${s.hits}次/${s.spanDays.toFixed(1)}天  ${String(x.text).slice(0, 34)}`)
  }
  const kinds = Object.keys(kindCount)
  if (kinds.length && kinds.every((k) => k === 'promise' || k === 'self-say')) {
    console.log('注意：卡住的**全是 promise / self-say 碎句**——是同一句话反复说在凑证据，不是长出来的认知。')
    console.log('结论：别靠 sweep 批量重算把它们升成 durable（会把人格灌成口头禅）。要升就得先收紧「独立证据」的定义。')
  } else {
    console.log('结论：卡住的不止碎句，先看 kind 分布，再决定是重算修漂移还是改规则。')
  }
}
