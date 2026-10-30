/**
 * 兼容自检：宿主版本多路来源（ctx / 环境变量 / asar）、工具注册失败要能被看见、
 * QQ 通道状态、数据目录可写、ok 判定
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOME = mkdtempSync(join(tmpdir(), 'dsh-compat-'))
process.env.DSH_HOME = HOME
delete process.env.QQBOT_REFINE_HOME
for (const k of ['DSH_CLIENT_VERSION', 'DSH_APP_VERSION', 'DSH_VERSION']) delete process.env[k]

const url = (p) => new URL(p, import.meta.url).href
const { ensureStore } = await import(url('../lib/config.js'))
const { ensureDirs } = await import(url('../lib/store.js'))
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

A('能从 asar 头里读出宿主版本', C.versionInAsar(asar).version === '0.2.1-rc.5', C.versionInAsar(asar))
A('坏路径给出原因不抛', (() => { const r = C.versionInAsar(join(asarDir, 'nope.asar')); return r.version === '' && !!r.reason })())

process.resourcesPath = asarDir
const info = C.hostInfo({ ttlMs: 0 })
A('走 resourcesPath 读出宿主版本', info.version === '0.2.1-rc.5' && info.source.includes('asar'), { v: info.version, s: info.source })
A('带 Node 版本和平台', !!info.node && info.platform.includes('-'), { node: info.node, platform: info.platform })

// ctx 给的版本优先（沙箱里 process 被裁时这条能救）
{
  const i2 = C.hostInfo({ ctxVersion: '0.9.9-test', ttlMs: 0 })
  A('ctx 版本优先', i2.version === '0.9.9-test' && i2.source === 'ctx', i2.source)
}

// 环境变量兜底
{
  process.env.DSH_CLIENT_VERSION = '0.3.0-env'
  const i3 = C.hostInfo({ ttlMs: 0 })
  A('环境变量兜底', i3.version === '0.3.0-env' && i3.source.startsWith('env:'), i3.source)
  delete process.env.DSH_CLIENT_VERSION
  C.hostInfo({ ttlMs: 0 }) // 让缓存回到 asar 那条路
}

// 版本正好在实测范围 → ok
{
  const r = C.compatReport({ version: '1.9.197' })
  const v = r.checks.find((c) => c.key === 'dshVersion')
  A('实测版本标 ok', v && v.level === 'ok' && v.note.includes('实测过'), v)
  A('报告带插件版本和实测范围', r.plugin === '1.9.197' && r.verified.dsh === '0.2.1-rc.5', r.verified)
  A('数据目录可写', r.checks.find((c) => c.key === 'dataDir')?.level === 'ok', r.checks.find((c) => c.key === 'dataDir'))
}

// 换一版没测过的 → warn，不冒充"能用"
{
  makeAsar(asar, { name: '@deepseek-ai/dsh-desktop', version: '0.2.2-rc.1' })
  C.hostInfo({ ttlMs: 0 })
  const r = C.compatReport({ version: '1.9.197' })
  const v = r.checks.find((c) => c.key === 'dshVersion')
  A('没测过的版本标 warn', v && v.level === 'warn' && v.note.includes('0.2.2-rc.1'), v)
}

// 一条路径都读不到时，把原因写出来
{
  C.hostInfo({ ttlMs: 0 })
  const saved = process.resourcesPath
  process.resourcesPath = join(asarDir, 'empty')
  const i4 = C.hostInfo({ ttlMs: 0 })
  process.resourcesPath = saved
  A('读不到时空版本 + 记录尝试', i4.version === '' && Array.isArray(i4.diag.tried) && i4.diag.tried.length >= 1, i4)
}

// 工具注册失败 → fail，且 ok=false
{
  toolGate.lastToolError = 'tool "web_search" must declare output { schema, render, presentationMeta? }'
  toolGate.registered = 0
  const r = C.compatReport({ version: '1.9.197' })
  const t = r.checks.find((c) => c.key === 'toolRegister')
  A('注册失败标 fail 并带原文', t && t.level === 'fail' && t.note.includes('must declare output'), t)
  A('有 fail 时整体 ok=false', r.ok === false)
}

// 注册成功 → ok
{
  toolGate.lastToolError = null
  toolGate.registered = 1
  const r = C.compatReport({ version: '1.9.197' })
  A('注册成功标 ok', r.checks.find((c) => c.key === 'toolRegister')?.level === 'ok')
}

// QQ 通道看的是我们自己的 OneBot 通道，不是官方 SDK 钩子
{
  const up = C.compatReport({ version: '1.9.197', transport: { mode: 'onebot', connected: true, endpoint: 'ws://127.0.0.1:3001', account: { uin: 1, nickname: '鲸鱼娘' }, channel: { sessions: 2, counts: { inbound: 5 } } } })
  const c1 = up.checks.find((c) => c.key === 'qqChannel')
  A('OneBot 已连标 ok', c1.level === 'ok' && c1.note.includes('鲸鱼娘'), c1)
  const down = C.compatReport({ version: '1.9.197', transport: { mode: 'onebot', connected: false, endpoint: 'ws://127.0.0.1:3001', lastError: 'ECONNREFUSED' } })
  const c2 = down.checks.find((c) => c.key === 'qqChannel')
  A('OneBot 断了标 fail 并带原因', c2.level === 'fail' && c2.note.includes('ECONNREFUSED'), c2)
  A('OneBot 断了整体 ok=false', down.ok === false)
}

// 检查项齐全（面板靠这些键渲染）
{
  const keys = C.compatReport({ version: '1.9.197' }).checks.map((c) => c.key)
  const want = ['dshVersion', 'toolRegister', 'toolApi', 'agentShape', 'qqChannel', 'dataDir']
  A('检查项齐全', want.every((k) => keys.includes(k)), keys)
}

console.log('=== 兼容自检测试 ===')
let fail = 0
for (const [n, p, d] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d))); if (!p) fail++ }
console.log(fail ? `失败 ${fail}` : '全部通过')
try { rmSync(HOME, { recursive: true, force: true }); rmSync(asarDir, { recursive: true, force: true }) } catch { /* ignore */ }
process.exitCode = fail ? 1 : 0
