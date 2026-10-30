/**
 * 兼容自检：从 asar 抠宿主版本、工具注册失败要能被看见、数据目录可写、ok 判定
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOME = mkdtempSync(join(tmpdir(), 'dsh-compat-'))
process.env.DSH_HOME = HOME
delete process.env.QQBOT_REFINE_HOME

const url = (p) => new URL(p, import.meta.url).href
const { ensureStore } = await import(url('../lib/config.js'))
const { ensureDirs, dirs } = await import(url('../lib/store.js'))
ensureStore(); ensureDirs()

const C = await import(url('../lib/compat.js'))
const { toolGate } = await import(url('../lib/toolgate.js'))

const ok = []
const A = (n, p, d) => ok.push([n, !!p, d])

/** 造一个和真 asar 头部结构一致的假包（reader 只认 16 字节前缀 + header + 数据区） */
function makeAsar(path, pkgObj) {
  const pkg = Buffer.from(JSON.stringify(pkgObj), 'utf8')
  let header = Buffer.from(JSON.stringify({ files: { 'package.json': { offset: '0', size: pkg.length } } }), 'utf8')
  const pad = (4 - (header.length % 4)) % 4
  if (pad) header = Buffer.concat([header, Buffer.alloc(pad, 0)])
  const prefix = Buffer.alloc(16)
  prefix.writeUInt32LE(4, 0)
  prefix.writeUInt32LE(header.length, 12)
  writeFileSync(path, Buffer.concat([prefix, header, pkg]))
}

const asarDir = mkdtempSync(join(tmpdir(), 'dsh-asar-'))
const asar = join(asarDir, 'app.asar')
makeAsar(asar, { name: '@deepseek-ai/dsh-desktop', version: '0.2.1-rc.5' })

A('能从 asar 头里读出宿主版本', C.versionInAsar(asar) === '0.2.1-rc.5', C.versionInAsar(asar))
A('坏路径不抛', C.versionInAsar(join(asarDir, 'nope.asar')) === '')

process.resourcesPath = asarDir
const env = C.dshEnv({ ttlMs: 0 })
A('环境探测到版本', env.dsh === '0.2.1-rc.5' && env.source === asar, env)
A('带 Node 版本', !!env.node && env.platform.includes('win') === process.platform.startsWith('win'), env)

// 版本正好在实测范围 → ok
{
  const r = C.compatReport({ version: '1.9.195' })
  const v = r.checks.find((c) => c.key === 'dshVersion')
  A('实测版本标 ok', v && v.level === 'ok' && v.note.includes('实测过'), v)
  A('报告带插件版本和实测范围', r.plugin === '1.9.195' && r.verified.dsh === '0.2.1-rc.5', r.verified)
  A('数据目录可写', r.checks.find((c) => c.key === 'dataDir')?.level === 'ok', r.checks.find((c) => c.key === 'dataDir'))
}

// 换一版没测过的 → warn，不冒充"能用"
{
  makeAsar(asar, { name: '@deepseek-ai/dsh-desktop', version: '0.2.2-rc.1' })
  C.dshEnv({ ttlMs: 0 })
  const r = C.compatReport({ version: '1.9.195' })
  const v = r.checks.find((c) => c.key === 'dshVersion')
  A('没测过的版本标 warn', v && v.level === 'warn' && v.note.includes('0.2.2-rc.1'), v)
}

// 工具注册失败 → fail，且 ok=false
{
  toolGate.lastToolError = 'tool "web_search" must declare output { schema, render, presentationMeta? }'
  toolGate.registered = 0
  const r = C.compatReport({ version: '1.9.195' })
  const t = r.checks.find((c) => c.key === 'toolRegister')
  A('注册失败标 fail 并带原文', t && t.level === 'fail' && t.note.includes('must declare output'), t)
  A('有 fail 时整体 ok=false', r.ok === false)
}

// 注册成功 → ok
{
  toolGate.lastToolError = null
  toolGate.registered = 1
  const r = C.compatReport({ version: '1.9.195' })
  const t = r.checks.find((c) => c.key === 'toolRegister')
  A('注册成功标 ok', t && t.level === 'ok' && t.note.includes('1'), t)
}

// 还会吐哪些检查项（面板靠这些键渲染）
{
  const keys = C.compatReport({ version: '1.9.195' }).checks.map((c) => c.key)
  const want = ['dshVersion', 'toolRegister', 'toolApi', 'agentShape', 'dataDir', 'qqChannel']
  A('检查项齐全', want.every((k) => keys.includes(k)), keys)
}

console.log('=== 兼容自检测试 ===')
let fail = 0
for (const [n, p, d] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d))); if (!p) fail++ }
console.log(fail ? `失败 ${fail}` : '全部通过')
try { rmSync(HOME, { recursive: true, force: true }); rmSync(asarDir, { recursive: true, force: true }) } catch { /* ignore */ }
process.exitCode = fail ? 1 : 0
