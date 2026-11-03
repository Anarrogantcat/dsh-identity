#!/usr/bin/env node
/**
 * 判断卡「记人」质量检查：一次蒸馏最多 3 条，够不够「关于人」。
 *
 *   node scripts/judge-quality.mjs            # 报告
 *   node scripts/judge-quality.mjs --strict   # 有轮次不达标就 exit 1
 *
 * 验收口径（docs/roadmap-2026-11-03.md 阶段 1 第 2 项）：
 *   新一轮判断卡里 ≥50% 是关于人的（偏好/雷区/关系），技术细节不超过 1 条。
 *
 * 只读 memory 目录。判断卡 = judge.js 蒸馏出来的（source=judge）；
 * 压缩摘要、今日复盘也是 origin=agent，但那是「事」不是对这个人的判断，别混进来。
 * 「一轮」按 createdAt 间隔切：两次蒸馏之间一般隔好几分钟，5 分钟内算同一轮。
 */
import { readdirSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { dirs } from '../lib/store.js'

export const PERSON = new Set(['preference', 'relation'])
export const TECH = new Set(['event', 'lesson'])
export const GAP_MS = 5 * 60 * 1000

export const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0)
export const fmt = (iso) => String(iso ?? '').replace('T', ' ').slice(0, 16)

/** 一轮判断：关于人几条、技术几条、达标没有 */
export function gradeRound(items) {
  const n = items.length
  const person = items.filter((x) => PERSON.has(x.category)).length
  const tech = items.filter((x) => TECH.has(x.category)).length
  return { n, person, tech, pass: n > 0 && person / n >= 0.5 && tech <= 1 }
}

/** 按 createdAt 间隔切轮：同一 peer、5 分钟内算同一轮 */
export function splitBatches(items, gapMs = GAP_MS) {
  const out = []
  let cur = null
  for (const it of items) {
    const t = Date.parse(it.at) || 0
    if (!cur || it.peer !== cur.peer || t - cur.last > gapMs) {
      cur = { peer: it.peer, at: it.at, items: [], last: t }
      out.push(cur)
    }
    cur.items.push(it)
    cur.last = t
  }
  return out
}

/** 只算 judge 蒸馏出来的判断卡 */
export function judgeCards(items) {
  return items.filter((x) => x.source === 'judge')
}

function loadItems(memDir) {
  const out = []
  if (!existsSync(memDir)) return out
  for (const f of readdirSync(memDir)) {
    if (!/^[^.].*\.json$/i.test(f) || f.endsWith('.full.json')) continue
    let db
    try { db = JSON.parse(readFileSync(join(memDir, f), 'utf8')) } catch { continue }
    const items = Array.isArray(db?.items) ? db.items : []
    for (const it of items) {
      if (String(it?.origin ?? '') !== 'agent') continue
      out.push({
        peer: f.replace(/\.json$/i, ''),
        text: String(it.text ?? ''),
        category: String(it.category ?? ''),
        source: String(it.source ?? ''),
        at: String(it.createdAt ?? it.at ?? ''),
      })
    }
  }
  return out.sort((a, b) => (Date.parse(a.at) || 0) - (Date.parse(b.at) || 0))
}

function main() {
  const strict = process.argv.includes('--strict')
  const all = loadItems(join(dirs.root, 'memory'))
  const items = judgeCards(all)

  console.log('=== 判断卡「记人」质量 ===')
  console.log('')
  const src = {}
  for (const it of all) src[it.source || '(空)'] = (src[it.source || '(空)'] ?? 0) + 1
  if (all.length) console.log('agent 记忆按 source：' + Object.entries(src).map(([k, v]) => `${k}=${v}`).join('  ') + '（只算 judge）')
  console.log('')
  if (!items.length) {
    console.log('还没有 judge 蒸馏出来的判断卡。')
    console.log('结论：没法验证——需要一次真实蒸馏后再跑这个脚本。')
    return 0
  }

  const cats = {}
  for (const it of items) cats[it.category || '(空)'] = (cats[it.category || '(空)'] ?? 0) + 1
  const personAll = items.filter((x) => PERSON.has(x.category)).length
  const techAll = items.filter((x) => TECH.has(x.category)).length
  console.log(`判断卡总数 ${items.length}｜关于人 ${personAll}（${pct(personAll, items.length)}%）｜技术/事件 ${techAll}｜其它 ${items.length - personAll - techAll}`)
  console.log('分类：' + Object.entries(cats).map(([k, v]) => `${k}=${v}`).join('  '))
  console.log('')

  const bs = splitBatches(items)
  let pass = 0
  for (const b of bs) {
    const g = gradeRound(b.items)
    if (g.pass) pass += 1
    console.log(`${g.pass ? '✅' : '❌'} ${fmt(b.at)}  ${b.peer}  n=${g.n} 人=${g.person} 技术=${g.tech}`)
    for (const it of b.items) console.log(`     · [${it.category}] ${it.text}`)
  }
  console.log('')
  console.log(`轮次 ${bs.length}｜达标 ${pass}（${pct(pass, bs.length)}%）｜验收线：关于人 ≥50% 且技术 ≤1 条`)
  const bad = bs.length - pass
  if (bad) console.log(`结论：有 ${bad} 轮不达标——判断还在记事，不在记人。`)
  else console.log('结论：每轮都达标。')
  return strict && bad ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main()
}
