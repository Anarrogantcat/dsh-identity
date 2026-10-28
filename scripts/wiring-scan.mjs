#!/usr/bin/env node
/**
 * P0.5 接线扫描（无依赖、可进 CI）
 *
 * 检查项：
 *   1. 面板字段 → 代码引用：FIELDS 声明了但全仓库没人读的「死旋钮」（ERROR）
 *   2. 字段名级引用（疑似动态读取，需人工确认）（WARN）
 *   3. 幽灵字段：代码读 cfg.x.y，但 DEFAULTS 里没有这一项（ERROR）
 *   4. 孤儿模块：lib 里没人 import 的文件（ERROR，入口需写进白名单）
 *   5. 死导出：export 了、全仓库没人用（含同文件）（WARN）
 *   6. import 环（ERROR，必须 0）
 *
 * 用法：
 *   node scripts/wiring-scan.mjs            # 摘要
 *   node scripts/wiring-scan.mjs --verbose  # 全量明细
 *   node scripts/wiring-scan.mjs --json
 * 退出码：有 ERROR 为 1。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const verbose = process.argv.includes('--verbose')
const jsonMode = process.argv.includes('--json')

/** 白名单：每条都要写原因。宁缺毋滥。 */
const ALLOW = {
  fields: {
    // 面板占位/宿主直读，必须写原因；P1 前清零
  },
  orphans: {
    'lib/admin.js': '当能力库被 gate 动态调用（见 capabilities），不是孤儿',
    'lib/bili.js': '命令入口由 gate 调起',
    'lib/budget.js': 'P4 接线：预算只给自动任务（日记/复盘），不给闲聊',
    'lib/downloads.js': '由 scripts 与安装流程使用',
    'lib/esports.js': '定时任务/命令入口',
    'lib/fit.js': '由 gate 判定调用',
    'lib/gateway.js': 'P11 接线：支付网关等确认码流程进来自动移除',
    'lib/lifecycle.js': 'P1 接线：traits 证据晋升与退休',
    'lib/mgmt.js': '管理命令由 gate 调起',
    'lib/sticker.js': '由 gate 调起',
  },
}

const read = (p) => readFileSync(join(ROOT, p), 'utf8')
const list = (dir) => {
  const walk = (rel) => readdirSync(join(ROOT, rel), { withFileTypes: true }).flatMap((d) => {
    const child = rel + '/' + d.name
    if (d.isDirectory()) return walk(child)
    return /\.(js|mjs)$/.test(d.name) ? [child.slice(dir.length + 1)] : []
  })
  return walk(dir)
}

const stripComments = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1')

const norm = (s) => s.replace(/\s+/g, '').replace(/\?\./g, '.')

function codeFiles() {
  const files = []
  for (const f of list('lib')) files.push(`lib/${f}`)
  for (const f of list('scripts')) files.push(`scripts/${f}`)
  for (const f of list('test')) files.push(`test/${f}`)
  for (const f of ['index.js', 'client.js']) files.push(f)
  return files.filter((f) => !f.endsWith('wiring-scan.mjs'))
}

const SOURCES = new Map()
for (const f of codeFiles()) SOURCES.set(f, stripComments(read(f)))
const codeText = [...SOURCES].filter(([f]) => f !== 'lib/config.js').map(([, s]) => s).join('\n')

/** DEFAULTS 叶子路径 */
function leaves(obj, prefix = '', out = { leaves: [], objs: [] }) {
  for (const [k, v] of Object.entries(obj ?? {})) {
    const p = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out.objs.push(p)
      leaves(v, p, out)
    } else out.leaves.push(p)
  }
  return out
}

const cfgMod = await import(pathToFileURL(join(ROOT, 'lib/config.js')).href)
const { FIELDS, DEFAULTS } = cfgMod
const { leaves: defaultLeaves, objs: defaultObjs } = leaves(DEFAULTS)
const defaultPaths = new Set(defaultLeaves)
const declaredPaths = new Set([...defaultLeaves, ...defaultObjs, ...FIELDS.map((f) => f.k)])
const fieldPaths = new Set(FIELDS.map((f) => f.k))

/** 1+2) 死旋钮 / 间接引用 */
const deadFields = []
const indirectFields = []
for (const f of FIELDS) {
  if (ALLOW.fields[f.k]) continue
  if (codeText.includes(norm(f.k))) continue
  const leaf = f.k.split('.').pop()
  const re = new RegExp(`\\b${leaf.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)
  if (re.test(codeText)) indirectFields.push(f.k)
  else deadFields.push(f.k)
}

/** 面板有、默认值没有：面板改了会被 deepMerge 吃掉 */
const fieldNoDefault = FIELDS.filter((f) => !defaultPaths.has(f.k)).map((f) => f.k)

/** 3) 幽灵字段 */
const topSections = new Set(Object.keys(DEFAULTS))
const ghost = []
for (const [file, raw] of SOURCES) {
  if (file.startsWith('test/')) continue          // 测试用局部小 cfg，不按完整 settings 判
  const re = /cfg\s*\.\s*([A-Za-z_$][\w$]*)(?:\s*\?*\.\s*([A-Za-z_$][\w$]*))?/g
  let m
  while ((m = re.exec(raw))) {
    const sec = m[1]
    const full = m[2] ? `${sec}.${m[2]}` : sec
    if (!topSections.has(sec)) continue           // 本地 cfg 对象，跳过
    if (!m[2]) continue                            // 整段读取 cfg.section，不算幽灵
    if (declaredPaths.has(full)) continue
    ghost.push(`${file}: cfg.${full}`)
  }
}

/** 4) 孤儿模块（没有任何其他文件 import 它） */
const orphans = []
for (const f of list('lib')) {
  const p = `lib/${f}`
  if (ALLOW.orphans[p]) continue
  const base = f.replace(/\.js$/, '')
  let imported = false
  for (const [other, raw] of SOURCES) {
    if (other === p) continue
    const re = new RegExp(`['"]\\.\\.?/(?:lib/)?${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\.js)?['"]`)
    if (re.test(raw)) { imported = true; break }
  }
  if (!imported) orphans.push(p)
}

/** 5) 死导出（全仓库没人用，含同文件） */
const deadExports = []
for (const f of list('lib')) {
  const raw = SOURCES.get(`lib/${f}`)
  const names = new Set()
  for (const m of raw.matchAll(/^export\s+(?:async\s+)?(?:const|let|function|class)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1])
  for (const m of raw.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of m[1].split(',')) {
      const n = part.trim().split(/\s+as\s+/).pop()?.trim()
      if (n) names.add(n)
    }
  }
  for (const name of names) {
    const re = new RegExp(`\\b${name}\\b`)
    let used = false
    for (const [file, text] of SOURCES) {
      if (file === `lib/${f}`) continue
      if (re.test(text)) { used = true; break }
    }
    if (!used) deadExports.push(`lib/${f}: ${name}`)
  }
}

/** 6) import 环 */
const graph = new Map()
const moduleFiles = [...list('lib').map((f) => `lib/${f}`), 'index.js', 'client.js']
for (const f of moduleFiles) {
  const raw = SOURCES.get(f) ?? ''
  const edges = new Set()
  for (const m of raw.matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
    let rel = relative(ROOT, resolve(ROOT, dirname(f), m[1])).replace(/\\/g, '/')
    if (!/\.(js|mjs)$/.test(rel)) rel += '.js'
    if (moduleFiles.includes(rel)) edges.add(rel)
  }
  graph.set(f, [...edges])
}
const cycles = []
const state = new Map()
const stack = []
const walk = (n) => {
  state.set(n, 1)
  stack.push(n)
  for (const m of graph.get(n) ?? []) {
    if (state.get(m) === 1) cycles.push([...stack.slice(stack.indexOf(m)), m].join(' -> '))
    else if (!state.get(m)) walk(m)
  }
  stack.pop()
  state.set(n, 2)
}
for (const f of moduleFiles) if (!state.get(f)) walk(f)

const report = {
  deadFields,
  indirectFields,
  fieldNoDefault,
  ghost: [...new Set(ghost)],
  orphans,
  deadExports,
  cycles: [...new Set(cycles)],
}

if (jsonMode) {
  console.log(JSON.stringify(report, null, 2))
} else {
  const show = (arr) => (verbose ? arr : arr.slice(0, 15))
  const more = (arr, n) => (!verbose && arr.length > n ? `  … 另 ${arr.length - n} 条（--verbose 看全量）` : null)
  console.log(`\n=== 接线扫描 ===`)
  console.log(`[1] 死旋钮（面板有、代码不读）: ${deadFields.length}`)
  for (const k of show(deadFields)) console.log(`  ✗ ${k}`)
  if (more(deadFields, 15)) console.log(more(deadFields, 15))
  console.log(`[2] 疑似动态读取: ${indirectFields.length}`)
  for (const k of show(indirectFields)) console.log(`  ? ${k}`)
  if (more(indirectFields, 15)) console.log(more(indirectFields, 15))
  console.log(`[3] 幽灵字段（读了但没默认值）: ${report.ghost.length}`)
  for (const k of show(report.ghost)) console.log(`  ✗ ${k}`)
  if (more(report.ghost, 15)) console.log(more(report.ghost, 15))
  console.log(`[4] 面板字段缺默认值: ${fieldNoDefault.length}`)
  for (const k of show(fieldNoDefault)) console.log(`  ! ${k}`)
  if (more(fieldNoDefault, 15)) console.log(more(fieldNoDefault, 15))
  console.log(`[5] 孤儿模块: ${orphans.length}`)
  for (const k of show(orphans)) console.log(`  ✗ ${k}`)
  console.log(`[6] 死导出（清理项）: ${deadExports.length}`)
  for (const k of show(deadExports)) console.log(`  · ${k}`)
  if (more(deadExports, 15)) console.log(more(deadExports, 15))
  console.log(`[7] import 环: ${report.cycles.length}`)
  for (const c of report.cycles) console.log(`  ✗ ${c}`)
  console.log('')
}

const errors = deadFields.length + fieldNoDefault.length + report.ghost.length + orphans.length + report.cycles.length
process.exitCode = errors ? 1 : 0
