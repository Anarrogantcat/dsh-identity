/**
 * 兼容自检：宿主版本 + 工具注册 + 依赖的接口形状 + 数据目录可写。
 *
 * 为什么要有：DSH 还在 rc，接口会收紧（0.2.1 就把 tools.register 的 output 变成强制），
 * 上一次坏掉时是"安静地少了功能"——工具没注册上，聊天照旧，谁都没发现。
 * 这里把「变了」变成面板上一行字，别靠猜。
 */
import { closeSync, existsSync, openSync, readSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { dirs } from './store.js'
import { toolGate } from './toolgate.js'
import { diag } from './diag.js'

/** 实测过的宿主版本；别的版本不是"不能用"，是"没测过" */
export const VERIFIED = { dsh: '0.2.1-rc.5', at: '2026-10-31' }

/** 从 asar 的头里抠 package.json 的 version（不读整包，只读头 + 目标文件） */
export function versionInAsar(asar) {  if (!asar || !existsSync(asar)) return ''
  let fd = -1
  try {
    fd = openSync(asar, 'r')
    const head = Buffer.alloc(16)
    readSync(fd, head, 0, 16, 0)
    const headerSize = head.readUInt32LE(12)
    if (!headerSize || headerSize > 32 * 1024 * 1024) return ''
    const hb = Buffer.alloc(headerSize)
    readSync(fd, hb, 0, headerSize, 16)
    const header = JSON.parse(hb.toString('utf8').replace(/\0+$/, ''))
    const node = header?.files?.['package.json']
    if (!node) return ''
    const size = Number(node.size)
    const off = Number(node.offset)
    if (!Number.isFinite(size) || !Number.isFinite(off) || size <= 0 || size > 1024 * 1024) return ''
    const fb = Buffer.alloc(size)
    readSync(fd, fb, 0, size, 16 + headerSize + off)
    const pkg = JSON.parse(fb.toString('utf8'))
    return String(pkg?.version || '')
  } catch { return '' } finally { if (fd >= 0) { try { closeSync(fd) } catch { /* ignore */ } } }
}

let cachedEnv = null
let cachedAt = 0

/** 宿主环境：Electron 主进程里 process.resourcesPath 指向 resources/ */
export function dshEnv({ now = Date.now(), ttlMs = 10 * 60000 } = {}) {
  // 时钟倒退（测试里塞假 now）也当过期，别拿旧值骗自己
  if (cachedEnv && now >= cachedAt && now - cachedAt < ttlMs) return cachedEnv
  const env = {
    dsh: '',
    source: '',
    electron: String(process.versions?.electron ?? ''),
    node: String(process.versions?.node ?? ''),
    platform: `${process.platform}-${process.arch}`,
  }
  const cands = []
  try { if (process.resourcesPath) cands.push(join(process.resourcesPath, 'app.asar')) } catch { /* ignore */ }
  try { if (process.execPath) cands.push(join(dirname(process.execPath), 'resources', 'app.asar')) } catch { /* ignore */ }
  for (const p of cands) {
    const v = versionInAsar(p)
    if (v) { env.dsh = v; env.source = p; break }
  }
  cachedEnv = env
  cachedAt = now
  return env
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
export function compatReport({ version = '', now = Date.now() } = {}) {
  const env = dshEnv({ now })
  const checks = []
  const add = (key, label, level, note) => checks.push({ key, label, level, note: String(note ?? '') })

  // 1) 宿主版本
  if (!env.dsh) {
    add('dshVersion', '宿主版本', 'warn', '读不到 DSH 版本（可能不在 Electron 主进程里跑）')
  } else if (env.dsh === VERIFIED.dsh) {
    add('dshVersion', '宿主版本', 'ok', `DSH ${env.dsh}（${VERIFIED.at} 实测过）`)
  } else {
    add('dshVersion', '宿主版本', 'warn', `DSH ${env.dsh}，不在实测范围（实测过 ${VERIFIED.dsh}）——接口可能已变，出问题先查这里`)
  }

  // 2) 工具注册：QQ 会话里的影子工具
  const registered = Number(toolGate.registered ?? 0)
  if (toolGate.lastToolError) {
    add('toolRegister', '工具注册', 'fail', String(toolGate.lastToolError))
  } else if (registered > 0) {
    add('toolRegister', '工具注册', 'ok', `已给 ${registered} 个会话注册扩展工具`)
  } else {
    add('toolRegister', '工具注册', 'warn', '还没建过 QQ 会话（建了才有答案）')
  }

  // 3) 工具服务接口
  const api = Array.isArray(toolGate.api) ? toolGate.api : []
  const need = ['get', 'register']
  const miss = need.filter((k) => !api.includes(k))
  if (!api.length) add('toolApi', '工具服务接口', 'warn', '还没装工具闸门，没探到接口')
  else if (miss.length) add('toolApi', '工具服务接口', 'fail', `缺少 ${miss.join('/')}（有：${api.join('/')}）`)
  else add('toolApi', '工具服务接口', 'ok', api.join(' / '))

  // 4) agent 形状：scoped 注册靠 agent.ctx.tools
  const shape = toolGate.lastShape?.agent
  if (!Array.isArray(shape)) {
    add('agentShape', '会话对象形状', 'warn', '还没跑过 QQ 会话')
  } else if (shape.includes('ctx')) {
    add('agentShape', '会话对象形状', 'ok', '带 ctx（scoped 工具注册有地方挂）')
  } else {
    add('agentShape', '会话对象形状', 'fail', `没有 ctx：${shape.join(',')}`)
  }

  // 5) 数据目录
  if (probeWritable()) add('dataDir', '数据目录可写', 'ok', dirs.tmp)
  else add('dataDir', '数据目录可写', 'fail', `写不进去：${dirs.tmp}`)

  // 6) QQ 通道（只影响 QQ，不影响 DSH 会话）
  if (diag.patch.inbound) add('qqChannel', 'QQ 通道钩子', 'ok', `SDK ${diag.sdkVersion ?? '?'}`)
  else add('qqChannel', 'QQ 通道钩子', 'warn', '没挂钩子（只用 DSH 会话就不用管）')

  return {
    at: new Date(now).toISOString(),
    plugin: String(version || ''),
    verified: VERIFIED,
    env,
    checks,
    ok: !checks.some((c) => c.level === 'fail'),
  }
}
