#!/usr/bin/env node
/**
 * 清理空壳认知（历史遗留）。
 *
 * 只处理「主体是空」的那一类：
 *   · 我把「把「？」这事弄明白」弄明白了        ← 双层包装
 *   · 我开始留意：把「？」这事弄明白            ← 模板本身
 * 判断标准跟 autonomy.js 的 substantive() 一致：拆出主体之后没有实际字符就算空壳。
 * 真人真事的「我把「报错怎么修」这事弄明白了」不动。
 *
 *   node scripts/prune-shell-traits.mjs           # 只看，不改
 *   node scripts/prune-shell-traits.mjs --apply   # 退休掉，写 .bak 备份
 */
import { copyFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { dirs } from '../lib/store.js'
import { listTraits, retireTrait } from '../lib/traits.js'
import { substantive, subjectOf as unwrap } from '../lib/autonomy.js'

const APPLY = process.argv.includes('--apply')
const PATH = join(dirs.root, 'traits.json')

/** 从一条认知里拆出它说的「那件事」；拆完交给 autonomy 的 subjectOf 再剥一层模板 */
function subjectOf(text) {
  const s = String(text ?? '').trim()
  // 两种句式都认：新的是「…」这事弄明白了，旧的是「…」弄明白了
  let m = s.match(/^我把「(.+)」这事弄明白了$/) || s.match(/^我把「(.+)」弄明白了$/)
  if (m) return unwrap({ title: m[1] })
  m = s.match(/^我开始留意：(.+)$/)
  if (m) return unwrap({ title: m[1] })
  return unwrap({ title: s })
}

const all = listTraits({ limit: 1000 })
const shells = all.filter((t) => {
  const text = String(t.text ?? '')
  if (!/我把「|我开始留意：/.test(text)) return false
  return !substantive(subjectOf(text))
})

console.log('=== 空壳认知检查 ===')
console.log(`traits 共 ${all.length} 条，命中空壳 ${shells.length} 条`)
for (const t of shells) console.log(`  [${t.status}] ${t.id}  ${t.text}`)

if (!shells.length) {
  console.log('没有要清的。')
  process.exit(0)
}

if (!APPLY) {
  console.log('\n（只看不改。确认后加 --apply 执行，会先备份 traits.json.bak-<时间戳>）')
  process.exit(0)
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
if (existsSync(PATH)) {
  const bak = `${PATH}.bak-${stamp}`
  copyFileSync(PATH, bak)
  console.log(`\n备份：${bak}`)
}
let n = 0
for (const t of shells) {
  if (retireTrait(t.id, 'shell-cleanup')) n++
}
console.log(`已退休 ${n} 条。`)
