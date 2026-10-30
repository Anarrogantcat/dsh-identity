/**
 * 兼容自检：宿主版本、工具注册、依赖的接口、QQ 通道、数据目录。
 *
 * 为什么要写：DSH 还在 rc，接口会收紧（0.2.1 把 tools.register 的 output 变成强制），
 * 上次坏掉时是"安静地少了功能"——工具没注册上，聊天照旧，谁都没发现。
 * 这里把「变了」变成面板上一行字，别靠猜。
 *
 * 宿主版本有几条来源（沙箱里 process 不一定是完整对象，所以不赌单一路径）：
 *   ctx 给的 version → DSH_CLIENT_VERSION 等环境变量 → resourcesPath/app.asar → execPath 同级 resources
 * 全失败就把每条路为什么失败写进 diag，state 里能看到。
 */
import { closeSync, existsSync, openSync, readSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { dirs } from './store.js'
import { toolGate } from './toolgate.js'
import { diag } from './diag.js'

/** 实测过的宿主版本；别的版本不是"不能用"，是"没测过" */
export const VERIFIED = { dsh: '0.2.1-rc.5', at: '2026-10-31' }
const ENV_KEYS = ['DSH_CLIENT_VERSION', 'DSH_APP_VERSION', 'DSH_VERSION']

/** 从 asar 头里抠 package.json 的 version（不读整包，只读头 + 目标文件） */
export function versionInAsar(asar) {
  if (!asar || !existsSync(asar)) return { version: '', reason: '文件不存在' }
  let fd = -1
  try {
    fd = openSync(asar, 'r')
    const head = Buffer.alloc(16)
    readSync(fd, head, 0, 16, 0)
    const headerSize = head.readUInt32LE(12)
    if (!headerSize || headerSize > 32 * 1024 * 1024) return { version: '', reason: '头部长度不对' }
    const hb = Buffer.alloc(headerSize)
    readSync(fd, hb, 0, headerSize, 16)
    const header = JSON.parse(hb.toString('utf8').replace(/\0+$/, ''))
    const node = header?.files?.['package.json']
    if (!node) return { version: '', reason: '头里没有 package.json' }
    const size = Number(node.size)
    const off = Number(node.offset)
    if (!Number.isFinite(size) || !Number.isFinite(off) || size <= 0 || size > 1024 * 1024) return { version: '', reason: 'package.json 大小异常' }
    const fb = Buffer.alloc(size)
    readSync(fd, fb, 0, size, 16 + headerSize + off)
    const pkg = JSON.parse(fb.toString('utf8'))
    return { version: String(pkg?.version || ''), reason: pkg?.version ? '' : 'package.json 里没有 version' }
  } catch (e) {
    return { version: '', reason: String(e?.message ?? e).slice(0, 80) }
  } finally { if (fd >= 0) { try { closeSync(fd) } catch { /* ignore */ } } }
}

let cached = null
let cachedAt = 0

/**
 * 宿主信息：{ version, source, electron, node, platform, diag:{ resourcesPath, execPath, cwd, envHit, tried[] } }
 * ctxVersion 由调用方从 ctx 里取（沙箱里 process 可能被裁过，ctx 更可信）。
 */
export function hostInfo({ ctxVersion = '', now = Date.now(), ttlMs = 10 * 60000 } = {}) {
  // 时钟倒退（测试里塞假 now）也当过期，别拿旧值骗自己
  if (cached && now >= cachedAt && now - cachedAt < ttlMs) return cached
  const info = {
    version: '',
    source: '',
    electron: String(process.versions?.electron ?? ''),
    node: String(process.versions?.node ?? ''),
    platform: `${process.platform}-${process.arch}`,
    diag: { resourcesPath: '', execPath: '', cwd: '', envHit: '', tried: [] },
  }
  const tried = info.diag.tried
  const take = (v, source) => {
    if (!v || info.version) return
    info.version = String(v)
    info.source = source
  }

  take(ctxVersion, 'ctx')
  if (!info.version) {
    for (const k of ENV_KEYS) {
      const v = (() => { try { return process.env?.[k] } catch { return '' } })()
      if (v && /^\d+\.\d+\.\d+/.test(String(v))) { take(v, 'env:' + k); info.diag.envHit = k; break }
    }
  }

  const rp = (() => { try { return String(process.resourcesPath || '') } catch { return '' } })()
  const ep = (() => { try { return String(process.execPath || '') } catch { return '' } })()
  const cwd = (() => { try { return String(process.cwd() || '') } catch { return '' } })()
  info.diag.resourcesPath = rp
  info.diag.execPath = ep
  info.diag.cwd = cwd

  const cands = []
  if (rp) cands.push({ path: join(rp, 'app.asar'), why: 'resourcesPath' })
  if (ep) {
    cands.push({ path: join(dirname(ep), 'resources', 'app.asar'), why: 'execPath/resources' })
    cands.push({ path: join(dirname(ep), '..', 'Resources', 'app.asar'), why: 'execPath/../Resources' })
  }
  for (const c of cands) {
    if (info.version) break
    const r = versionInAsar(c.path)
    tried.push({ path: c.path, why: c.why, ok: !!r.version, reason: r.reason })
    if (r.version) take(r.version, 'asar:' + c.why)
  }

  cached = info
  cachedAt = now
  return info
}

function probeWritable() {
  const p = join(dirs.tmp, `compat-${process.pid}-${Date.now()}.tmp`)
  try {
    writeFileSync(p, 'ok', 'utf8')
    unlinkSync(p)
    return true
  } catch { return false }
}

/**
 * 自检报告：checks 每项 { key, label, level: ok|warn|fail, note }
 * level 只表达"我们这边看到的状态"，不猜宿主能不能用。
 */
export function compatReport({ version = '', ctxVersion = '', transport = null, now = Date.now() } = {}) {
  const host = hostInfo({ ctxVersion, now })
  const checks = []
  const add = (key, label, level, note) => checks.push({ key, label, level, note: String(note ?? '') })

  // 1) 宿主版本
  if (!host.version) {
    const why = (host.diag.tried || []).filter((t) => !t.ok).map((t) => `${t.why}: ${t.reason}`).slice(0, 2).join('；')
    add('dshVersion', '宿主版本', 'warn', '读不到（' + (why || '沙箱里没有 process 路径信息') + '）')
  } else if (host.version === VERIFIED.dsh) {
    add('dshVersion', '宿主版本', 'ok', `DSH ${host.version}（${VERIFIED.at} 实测过）`)
  } else {
    add('dshVersion', '宿主版本', 'warn', `DSH ${host.version}，不在实测范围（实测过 ${VERIFIED.dsh}）——接口可能已变，出问题先查这里`)
  }

  // 2) 工具注册：QQ 会话里的影子工具
  const registered = Number(toolGate.registered ?? 0)
  if (toolGate.lastToolError) {
    add('toolRegister', '工具注册', 'fail', String(toolGate.lastToolError))
  } else if (registered > 0) {
    add('toolRegister', '工具注册', 'ok', `已给 ${registered} 个会话注册扩展工具`)
  } else {
    add('toolRegister', '工具注册', 'warn', '还没建过 QQ 会话（有人说话后才有答案）')
  }

  // 3) 工具服务接口
  const api = Array.isArray(toolGate.api) ? toolGate.api : []
  const need = ['get', 'register']
  const miss = need.filter((k) => !api.includes(k))
  if (!api.length) add('toolApi', '工具服务接口', 'warn', '还没装工具闸门，没探到接口')
  else if (miss.length) add('toolApi', '工具服务接口', 'fail', `缺少 ${miss.join('/')}（有：${api.join('/')}）`)
  else add('toolApi', '工具服务接口', 'ok', api.join(' / '))

  // 4) 会话对象形状：scoped 注册靠 agent.ctx.tools
  const shape = toolGate.lastShape?.agent
  if (!Array.isArray(shape)) {
    add('agentShape', '会话对象形状', 'warn', '还没跑过 QQ 会话')
  } else if (shape.includes('ctx')) {
    add('agentShape', '会话对象形状', 'ok', '带 ctx（scoped 工具注册有地方挂）')
  } else {
    add('agentShape', '会话对象形状', 'fail', `没有 ctx：${shape.join(',')}`)
  }

  // 5) QQ 通道：我们自己那条 OneBot 通道才决定 QQ 能不能用
  const mode = String(transport?.mode ?? '')
  if (mode === 'onebot') {
    const ch = transport?.channel ?? {}
    if (transport.connected) {
      const uin = transport?.account?.uin ? `（${transport.account.nickname || ''} ${transport.account.uin}）` : ''
      add('qqChannel', 'QQ 通道', 'ok', `OneBot 已连${uin} · 会话 ${Number(ch.sessions ?? 0)} 个 · 收 ${Number(ch.counts?.inbound ?? 0)} 条`)
    } else {
      add('qqChannel', 'QQ 通道', 'fail', `OneBot 没连上：${transport?.lastError || '未知原因'}（${transport?.endpoint || ''}）`)
    }
  } else if (diag.patch.inbound) {
    add('qqChannel', 'QQ 通道', 'ok', `官方 SDK 钩子已挂（${diag.sdkVersion ?? '?'}）`)
  } else {
    add('qqChannel', 'QQ 通道', 'warn', '没有 QQ 通道（只用 DSH 会话就不用管）')
  }

  // 6) 数据目录
  if (probeWritable()) add('dataDir', '数据目录可写', 'ok', dirs.tmp)
  else add('dataDir', '数据目录可写', 'fail', `写不进去：${dirs.tmp}`)

  return {
    at: new Date(now).toISOString(),
    plugin: String(version || ''),
    verified: VERIFIED,
    host: { version: host.version, source: host.source, electron: host.electron, node: host.node, platform: host.platform },
    // 兼容旧字段名（面板早期版本读 env）
    env: { dsh: host.version, source: host.source, electron: host.electron, node: host.node, platform: host.platform },
    hostDiag: host.diag,
    checks,
    ok: !checks.some((c) => c.level === 'fail'),
  }
}
