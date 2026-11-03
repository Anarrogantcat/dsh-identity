#!/usr/bin/env node
/**
 * 清理宿主 goal_round 注入被误记进记忆的条目。
 *
 *   node scripts/clean-goalround.mjs [--dry]
 *
 * 为什么：任务续跑时宿主会往会话里塞 `<goal_round>Objective: ...</goal_round>`，
 * webgrowth 以前没剥，被当成「用户说的话」记进了记忆，还会被当成长篇原话注回提示词。
 * 现在剥离规则已经补上，这个脚本只负责把已经污染的清掉（先备份）。
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { dirs } from '../lib/store.js'

const dry = process.argv.includes('--dry')
const MARK = /<goal_round>|<goal_blocked>|^objective:\s*"/i

let files = 0
let removed = 0
for (const f of readdirSync(dirs.memory)) {
  if (!f.endsWith('.json')) continue
  const p = join(dirs.memory, f)
  let db
  try { db = JSON.parse(readFileSync(p, 'utf8')) } catch { continue }
  if (!db || !Array.isArray(db.items)) continue
  const keep = db.items.filter((i) => !MARK.test(String(i?.text ?? '')))
  const n = db.items.length - keep.length
  if (!n) continue
  files++
  removed += n
  if (dry) { console.log('[dry] ' + f + ' 要删 ' + n + ' 条'); continue }
  if (!existsSync(p + '.bak-goalround')) writeFileSync(p + '.bak-goalround', readFileSync(p))
  db.items = keep
  db.n = keep.length
  writeFileSync(p, JSON.stringify(db))
  console.log(f + ' 删了 ' + n + ' 条')
}

// 全量卡里也清一遍
for (const f of readdirSync(dirs.memory)) {
  if (!f.endsWith('.full.jsonl')) continue
  const p = join(dirs.memory, f)
  const lines = readFileSync(p, 'utf8').split('\n').filter(Boolean)
  const keep = lines.filter((l) => !MARK.test(l))
  const n = lines.length - keep.length
  if (!n) continue
  removed += n
  if (dry) { console.log('[dry] ' + f + ' 全量卡要删 ' + n + ' 条'); continue }
  if (!existsSync(p + '.bak-goalround')) writeFileSync(p + '.bak-goalround', lines.join('\n') + '\n')
  writeFileSync(p, keep.length ? keep.join('\n') + '\n' : '')
  console.log(f + ' 全量卡删了 ' + n + ' 条')
}

console.log(dry ? '（dry run，未写入）' : ('共清理 ' + removed + ' 条，涉及 ' + files + ' 个文件'))
