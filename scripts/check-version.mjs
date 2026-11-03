#!/usr/bin/env node
/**
 * 新版到底有没有加载？一条命令说清楚。
 *
 *   node scripts/check-version.mjs
 *
 * 判断依据只有两条（都不靠猜）：
 *   1. 进程写的 pace.reply 审计里有没有 tone 字段——旧版没有
 *   2. pace.json 有没有 tiredDay——旧版不写
 * 再加一条「部署目录和源码是不是一致」，防止改了没同步。
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirs, readJson } from '../lib/store.js'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..')

const pass = (b) => (b ? '✅' : '❌')
const line = (k, v) => console.log(String(k).padEnd(16) + ' ' + v)

console.log('=== dsh-identity 新版加载检查 ===')
console.log('')

// 1. pace.json 有没有新字段
const pace = readJson(join(dirs.root, 'pace.json'), null)
const hasTired = !!(pace && (pace.tired !== undefined || pace.tiredDay !== undefined))
line('pace 新字段', hasTired ? '有（tired/tiredDay）' : '没有 → 进程还是旧版')

// 2. 审计里最近的 pace.reply 有没有 tone
let hasTone = false
try {
  const p = join(dirs.logs, 'audit.jsonl')
  if (existsSync(p)) {
    const lines = readFileSync(p, 'utf8').trim().split('\n').slice(-800)
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!/"kind":"pace\.reply"/.test(lines[i])) continue
      try { hasTone = 'tone' in JSON.parse(lines[i]) } catch { /* ignore */ }
      break
    }
  }
} catch { /* ignore */ }
line('审计 tone 字段', hasTone ? '有 → 新版在写审计' : '没有 → 旧版还在跑')

// 3. 部署目录 vs 源码（忽略换行符；要递归——lib 下有 channel-qq 这种子目录，
//    以前没递归还吞掉 EISDIR，导致「明明没同步也说一致」，这个坑必须钉死）
let diff = 0
let compared = 0
function walk(base, rel = '') {
  for (const name of readdirSync(join(base, rel))) {
    const r = rel ? join(rel, name) : name
    const full = join(base, r)
    if (statSync(full).isDirectory()) { walk(base, r); continue }
    if (!r.endsWith('.js')) continue
    compared++
    const dep = join(process.env.USERPROFILE || '', '.dsh', 'plugins', 'dsh-identity', 'lib', r)
    if (!existsSync(dep)) { diff++; continue }
    if (readFileSync(full, 'utf8').replace(/\r/g, '') !== readFileSync(dep, 'utf8').replace(/\r/g, '')) diff++
  }
}
try {
  const depRoot = join(process.env.USERPROFILE || '', '.dsh', 'plugins', 'dsh-identity', 'lib')
  if (existsSync(depRoot)) walk(join(repo, 'lib'))
  else line('部署目录', '找不到，检查路径')
} catch (err) { line('比对出错', String(err?.message ?? err).slice(0, 60)) }
line('代码同步', diff === 0 ? ('源码与部署一致（' + compared + ' 个 js）') : diff + ' 个文件不一致')

console.log('')
if (hasTired && hasTone) console.log('结论：新版已经在跑了')
else if (diff === 0) console.log('结论：代码已同步，但进程还是旧版 → 需要重启 DSH')
else console.log('结论：先跑同步，再重启')
