#!/usr/bin/env node
/**
 * 成长链现状：一条命令把「像人」那几条链的数据摊开看。
 * 重启插件后跑一次，就知道是长出来了还是照旧。
 *
 *   node scripts/growth-status.mjs            # 看一眼
 *   node scripts/growth-status.mjs --append   # 顺手记进 growth-log.jsonl，攒成时间线
 */
import { readdirSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { dirs, readJson } from '../lib/store.js'
import * as traits from '../lib/traits.js'
import { listMemory } from '../lib/memory.js'
import { history } from '../lib/selfmodel.js'
import { dueOpen } from '../lib/open-topics.js'
import { listGoals } from '../lib/autonomy.js'

const line = (k, v) => console.log(String(k).padEnd(14) + ' ' + v)
const safe = (fn, fallback = '-') => { try { return fn() } catch { return fallback } }
const rec = { at: new Date().toISOString() }

console.log('=== dsh-identity 成长链现状 ===')
console.log('')

// 1. 精力——只读文件，不调用会顺手写盘的 snapshot（不然诊断本身就把状态改了）
const p = safe(() => readJson(join(dirs.root, 'pace.json'), null), null)
if (p) {
  const energy = Number(p.energy ?? 0)
  const tone = energy >= 0.55 ? 'full' : energy >= 0.3 ? 'terse' : 'low'
  const tired = Number(p.tired ?? 0)
  Object.assign(rec, { energy: Number(energy.toFixed(2)), tone, tired, streak: Number(p.streak ?? 0) })
  line('精力', (energy * 100).toFixed(0) + '%  ' + tone + (p.streak ? '  连说 ' + p.streak + ' 句' : ''))
  line('今日硬撑', tired + ' 次' + (tired ? '  ← 累着也回了' : '') + (p.tiredDay ? '' : '  （旧版没这个字段）'))
} else line('精力', '读不到')

// 2. 自我认知
const ts = safe(() => traits.listTraits({ limit: 1000 }), [])
const durable = ts.filter((t) => t.status === 'durable')
const tentative = ts.filter((t) => t.status === 'tentative')
rec.durable = durable.length
rec.tentative = tentative.length
line('自我认知', ts.length + ' 条（稳定 ' + durable.length + ' / 待观察 ' + tentative.length + '）')
for (const t of durable.slice(0, 5)) console.log('              · ' + String(t.text).slice(0, 50))

// 3. 自我快照
const h = safe(() => history(3), [])
rec.snapshots = h.length
line('自我轨迹', h.length ? h.length + ' 条快照' : '还没有')
for (const x of h.slice(0, 2)) console.log('              ' + String(x.summary || '').slice(0, 90))

// 4. 判断卡（扫 memory 目录）
let judgeN = 0
let peerN = 0
try {
  for (const f of readdirSync(dirs.memory)) {
    if (!f.endsWith('.json')) continue
    const pk = f.replace(/\.json$/, '')
    const items = safe(() => listMemory(pk), [])
    const n = items.filter((x) => x.source === 'judge' || (x.origin === 'agent' && x.category === 'relation')).length
    if (n) { judgeN += n; peerN += 1 }
  }
} catch { /* ignore */ }
rec.judgments = judgeN
line('判断卡', judgeN + ' 条（来自 ' + peerN + ' 个会话）')

// 5. 惦记的事
const ot = safe(() => dueOpen('__scan__', 0), null)
line('惦记的事', ot ? String(ot.text).slice(0, 50) : '（按会话分散存，这里只做存在性检查）')

// 6. 自主目标
const goals = safe(() => listGoals(), [])
const approved = goals.filter((g) => g.status === 'approved')
rec.goals = goals.length
line('自主目标', goals.length + ' 个（推进中 ' + approved.length + '）')

console.log('')
console.log('数据目录：' + dirs.root)

if (process.argv.includes('--append')) {
  try {
    appendFileSync(join(dirs.root, 'growth-log.jsonl'), JSON.stringify(rec) + '\n')
    console.log('已追加到 growth-log.jsonl')
  } catch (err) { console.log('追加失败：' + (err?.message ?? err)) }
}
