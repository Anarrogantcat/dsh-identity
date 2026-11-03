#!/usr/bin/env node
/**
 * 自检：一条命令把「环境问题」和「插件 bug」分开。
 *
 * 给「装完就崩」那种反馈用——在容器里裸跑：
 *   node scripts/selfcheck.mjs
 *
 * 只读为主；唯一会写的是存储目录里的一个临时探针文件（写完就删）。
 * 退出码：0 = 核心检查都过；1 = 有硬失败（import 不了 / 目录写不进 / 配置解析不了）。
 */
import { readFileSync, writeFileSync, rmSync, existsSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const rows = []
const hard = []

async function check(name, fn, { hardFail = true } = {}) {
  try {
    const detail = await fn()
    rows.push(['ok', name, detail === undefined ? '' : String(detail)])
  } catch (err) {
    rows.push(['FAIL', name, String(err?.message ?? err).slice(0, 160)])
    if (hardFail) hard.push(name)
  }
}

// 1. 运行环境
await check('Node 版本', () => {
  const v = process.version
  const major = Number(String(v).replace('v', '').split('.')[0])
  if (!(major >= 20)) throw new Error('需要 Node >= 20，当前 ' + v)
  return v + ' / ' + process.platform + '-' + process.arch
})

// 2. 插件本体
await check('package.json 可读', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  return (pkg.name || '?') + ' ' + (pkg.version || '?')
})

await check('panel.html 可读', () => {
  const p = join(root, 'panel.html')
  if (!existsSync(p)) throw new Error('缺 panel.html')
  return Math.round(statSync(p).size / 1024) + ' KB'
})

// 3. 数据目录可写（容器里最常见的坑：只读挂载 / 权限不对）
let storeRoot = ''
await check('数据目录可写', async () => {
  const { dirs, ensureDirs } = await import('../lib/store.js')
  ensureDirs() // 宿主启动时也会建；先建再探，才测得出「能不能写」而不是「存不存在」
  storeRoot = dirs.root
  const probe = join(dirs.root, '.selfcheck-probe')
  writeFileSync(probe, 'ok', 'utf8')
  const back = readFileSync(probe, 'utf8')
  rmSync(probe, { force: true })
  if (back !== 'ok') throw new Error('写进去读不出来')
  return dirs.root
})

// 4. 模块能 import（语法错、缺依赖会在这里炸）
await check('index.js 能 import', async () => {
  const m = await import('../index.js')
  const n = Object.keys(m).length
  if (!n) throw new Error('没有导出')
  return n + ' 个导出'
})

// 5. 配置与已有数据能解析
await check('配置可解析', async () => {
  const { loadConfig } = await import('../lib/config.js')
  const cfg = loadConfig()
  if (!cfg || typeof cfg !== 'object') throw new Error('loadConfig 返回空')
  return 'ok'
})

for (const file of ['traits.json', 'autonomy.json', 'config.json']) {
  await check(file + ' 可解析', async () => {
    if (!storeRoot) return '（数据目录不可写，跳过）'
    const p = join(storeRoot, file)
    if (!existsSync(p)) return '（还没有，跳过）'
    const j = JSON.parse(readFileSync(p, 'utf8'))
    return typeof j === 'object' ? 'ok' : '结构不对'
  }, { hardFail: false })
}

console.log('=== dsh-identity 自检 ===')
console.log('插件目录：' + root)
console.log('DSH_HOME：' + (process.env.DSH_HOME || '（未设置，用默认）'))
console.log('')
for (const [level, name, detail] of rows) {
  console.log((level === 'ok' ? 'OK   ' : 'FAIL ') + name + (detail ? '  → ' + detail : ''))
}
console.log('')
if (hard.length) {
  console.log('结论：有硬失败（' + hard.join('、') + '）。多半是环境问题（Node 版本 / 目录权限 / 依赖缺失），' +
    '不是插件逻辑——把上面这段原样贴出来就行。')
  process.exit(1)
}
console.log('结论：核心检查全过。插件本体在这个环境里能加载——崩溃点更可能在宿主侧或与其它插件的交互。')
