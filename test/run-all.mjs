#!/usr/bin/env node
/**
 * 跑本项目全部测试（test/*-test.mjs）
 *
 * 每个测试文件都要一个独立的 DSH_HOME，避免互相污染；
 * 这里用 stdio:'inherit' 直接透传输出（Windows 沙箱下管道捕获可能被拒）。
 *
 *   node test/run-all.mjs
 *   node test/run-all.mjs onebot            # 只跑名字里带 onebot 的
 */
import { spawn } from 'node:child_process'
import { readdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const filter = process.argv[2] ?? ''
const files = readdirSync(here)
  .filter((f) => f.endsWith('-test.mjs'))
  .filter((f) => !filter || f.includes(filter))
  .sort()

if (!files.length) {
  console.log('没有匹配的测试文件')
  process.exit(1)
}

let pass = 0
const failed = []
for (const f of files) {
  const home = mkdtempSync(join(tmpdir(), 'dsh-test-'))
  const started = Date.now()
  const code = await new Promise((resolve) => {
    const child = spawn(process.execPath, [join(here, f)], {
      stdio: 'inherit',
      env: { ...process.env, DSH_HOME: home },
    })
    child.on('exit', (c) => resolve(c ?? 1))
    child.on('error', () => resolve(1))
  })
  rmSync(home, { recursive: true, force: true })
  const ms = Date.now() - started
  if (code === 0) {
    pass += 1
    console.log('  ✓ ' + f + '  (' + ms + 'ms)')
  } else {
    failed.push(f)
    console.log('  ✗ ' + f + '  (exit ' + code + ', ' + ms + 'ms)')
  }
}

console.log('')
console.log('测试文件：' + files.length + '  通过：' + pass + '  失败：' + failed.length)
if (failed.length) {
  console.log('失败的：')
  for (const f of failed) console.log('  - ' + f)
}
process.exit(failed.length ? 1 : 0)
