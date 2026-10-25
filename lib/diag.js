/** 定位 qqbot 实际加载的 SDK，并对 QQBot.prototype 做幂等挂钩 */
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const CANDIDATE_PKGS = [
  ['@tencent-connect', 'dsh-qqbot'],
  ['@zaofan', 'dsh-qqbot'],
]

export const diag = {
  checkedAt: null,
  qqbotPackage: null,
  sdkPath: null,
  sdkVersion: null,
  sdkError: null,
  hooks: { handleInboundMessage: false, emit: false },
  patch: { inbound: false, outbound: false },
  counts: { inbound: 0, blocked: 0, outbound: 0, redacted: 0, markers: 0 },
}

function profileNodeModules() {
  // 从本文件往上走，找到最近的 node_modules 目录（兼容嵌套/提升两种布局）
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 8; i++) {
    if (basename(dir) === 'node_modules') return dir
    const up = dirname(dir)
    if (up === dir) break
    dir = up
  }
  return dir
}

export function findQQBotPackage() {
  const base = profileNodeModules()
  for (const segs of CANDIDATE_PKGS) {
    const p = join(base, ...segs)
    if (existsSync(join(p, 'package.json'))) return p
  }
  return null
}

function findSdkDir(pkgDir) {
  const cands = [
    join(pkgDir, 'node_modules', '@tencent-connect', 'qqbot-nodejs'),
    join(pkgDir, '..', '@tencent-connect', 'qqbot-nodejs'),
    join(pkgDir, '..', '..', '@tencent-connect', 'qqbot-nodejs'),
  ]
  return cands.find((c) => existsSync(join(c, 'package.json'))) ?? null
}

function sdkEntry(sdkDir) {
  const pkg = JSON.parse(readFileSync(join(sdkDir, 'package.json'), 'utf8'))
  const exp = pkg.exports?.['.']
  const rel = (typeof exp === 'string' ? exp : exp?.import ?? exp?.default) ?? pkg.module ?? pkg.main ?? './dist/index.js'
  return { entry: join(sdkDir, rel), version: pkg.version ?? null }
}

let cached = null

/** 返回 { QQBot, entry, version, pkgDir }，失败时 error 字段说明原因 */
export async function loadQQBot() {
  if (cached) return cached
  const pkgDir = findQQBotPackage()
  diag.checkedAt = new Date().toISOString()
  diag.qqbotPackage = pkgDir
  if (!pkgDir) {
    cached = { error: '找不到 @tencent-connect/dsh-qqbot' }
    diag.sdkError = cached.error
    return cached
  }
  try {
    const sdkDir = findSdkDir(pkgDir)
    if (!sdkDir) throw new Error('找不到 @tencent-connect/qqbot-nodejs')
    const { entry, version } = sdkEntry(sdkDir)
    diag.sdkPath = entry
    diag.sdkVersion = version
    const mod = await import(new URL(`file://${entry.replace(/\\/g, '/')}`).href)
    const QQBot = mod.QQBot ?? mod.default?.QQBot
    if (!QQBot) throw new Error('模块未导出 QQBot')
    diag.hooks.handleInboundMessage = typeof QQBot.prototype.handleInboundMessage === 'function'
    diag.hooks.emit = typeof QQBot.prototype.emit === 'function'
    cached = { QQBot, entry, version, pkgDir }
    return cached
  } catch (err) {
    diag.sdkError = err instanceof Error ? err.message : String(err)
    cached = { error: diag.sdkError }
    return cached
  }
}

/**
 * 安装钩子（幂等）。handler：
 *   onInbound(bot, raw) -> Promise<boolean>  true=拦截
 *   onOutbound(kind, args) -> {block?:boolean, args?:any[]}
 */
export async function installHooks(handler, logger = console) {
  const loaded = await loadQQBot()
  if (loaded.error) {
    logger.warn?.(`[qqbot-refine] 挂钩失败：${loaded.error}`)
    return false
  }
  const { QQBot } = loaded
  const proto = QQBot.prototype

  if (!proto.__refineInbound && typeof proto.handleInboundMessage === 'function') {
    const orig = proto.handleInboundMessage
    proto.handleInboundMessage = async function (raw) {
      try {
        diag.counts.inbound += 1
        const blocked = await handler.onInbound(this, raw)
        if (blocked) {
          diag.counts.blocked += 1
          return
        }
      } catch (err) {
        handler.onError?.(err)
        // 出错一律放行，绝不吞消息
      }
      try {
        return await orig.call(this, raw)
      } catch (err) {
        try { const { audit } = await import('./store.js'); audit('inbound.error', { msg: String(err?.message ?? err).slice(0, 300), stack: String(err?.stack ?? '').split('\n').slice(0, 4).join(' | ').slice(0, 600), name: err?.name }) } catch {}
        throw err
      }
    }
    proto.__refineInbound = true
    diag.patch.inbound = true
  }

  for (const method of ['sendText', 'sendMarkdown', 'send', 'sendFile']) {
    const key = `__refine_${method}`
    if (proto[key] || typeof proto[method] !== 'function') continue
    const orig = proto[method]
    proto[method] = async function (...args) {
      try {
        diag.counts.outbound += 1
        const out = await handler.onOutbound(this, method, args)
        if (out?.block) return undefined
        if (out?.args) args = out.args
      } catch (err) {
        handler.onError?.(err)
      }
      return orig.apply(this, args)
    }
    proto[key] = true
    diag.patch.outbound = true
  }

  logger.info?.(
    `[qqbot-refine] 钩子已安装：inbound=${diag.patch.inbound} outbound=${diag.patch.outbound}（SDK ${diag.sdkVersion ?? '?'}）`,
  )
  return diag.patch.inbound
}
