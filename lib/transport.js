/**
 * 通道抽象：由 transport.mode 决定用哪条通道（单活，不共存）
 *
 *   tencent —— 包 @tencent-connect/dsh-qqbot 的 QQBot.prototype（现有行为）
 *   onebot  —— 自己连 NapCat 的 websocketServers：事件 → 闸门 → 宿主 agent → 发回 QQ
 *              整条通道都在本插件内实现，不依赖任何其他 DSH 插件
 */
import { loadConfig } from './config.js'
import { modeOf, capabilitySummary } from './capabilities.js'
import { OneBotClient } from './onebot-client.js'
import { createOneBotChannel } from './onebot-channel.js'
import { diag, loadQQBot, installHooks } from './diag.js'

let onebot = null
let channel = null
let tencentHooked = false
let lastError = ''
/** 安全层按需加载（它由 S5 提供；缺失时通道照常跑） */
let safety = null
async function loadSafety() {
  if (safety) return safety
  try { safety = await import('./safety.js') } catch { safety = null }
  return safety
}

export function getOneBotClient(cfg = loadConfig()) {
  const url = String(cfg?.transport?.onebot?.url ?? '')
  const token = String(cfg?.transport?.onebot?.token ?? '')
  if (!url) return null
  if (onebot && onebot.url === url && onebot.token === token) return onebot
  try { onebot?.stop() } catch { /* ignore */ }
  onebot = new OneBotClient({ url, token })
  return onebot
}

export async function startTransport(gate, logger = console, opts = {}) {
  await loadSafety()
  const cfg = loadConfig()
  const mode = modeOf(cfg)
  if (mode === 'onebot') {
    const client = getOneBotClient(cfg)
    if (client) {
      channel = createOneBotChannel({ ctx: opts.ctx ?? null, gate, client, logger, getConfig: loadConfig, hooks: opts.hooks ?? null })
      try { channel.start() } catch (err) { lastError = String(err?.message ?? err) }
      client.start()
      logger.info?.('[qqbot-refine] 通道=onebot，正在连 ' + client.url + (channel ? '（自建通道已挂载）' : ''))
    } else {
      lastError = 'transport.onebot.url 未配置'
      logger.warn?.('[qqbot-refine] 通道=onebot 但没配 WS 地址')
    }
    return { mode, hooked: !!channel }
  }
  // tencent
  const loaded = await loadQQBot()
  if (loaded.error) {
    lastError = loaded.error
    logger.warn?.('[qqbot-refine] SDK 未定位：' + loaded.error)
    return { mode, hooked: false }
  }
  const ok = await installHooks(gate, logger)
  tencentHooked = !!ok
  return { mode, hooked: tencentHooked }
}

export function stopTransport() {
  try { channel?.stop() } catch { /* ignore */ }
  channel = null
  try { onebot?.stop() } catch { /* ignore */ }
  onebot = null
}

export function transportDescribe() {
  const cfg = loadConfig()
  const mode = modeOf(cfg)
  const caps = capabilitySummary(cfg)
  if (mode === 'onebot') {
    const d = onebot?.describe() ?? { connected: false, endpoint: '', account: null, lastEventAt: 0, reconnects: 0, lastError: lastError || '未启动' }
    const health = d.connected ? (d.lastError ? 'warn' : 'ok') : 'bad'
    const ch = (() => { try { return channel?.describe() ?? null } catch { return null } })()
    const sent = ch?.counts?.sent ?? 0
    const failed = ch?.counts?.failed ?? 0
    const breaker = (() => { try { return safety?.breakerState?.() ?? null } catch { return null } })()
    const health2 = breaker?.open ? 'bad' : (d.connected ? (failed >= 3 ? 'warn' : 'ok') : 'bad')
    return {
      mode,
      ...d,
      health: health2,
      capabilities: caps,
      hooked: !!channel,
      channel: ch,
      selfHosted: true,
      sentToday: sent,
      failedToday: failed,
      successRate: sent + failed > 0 ? Number(((sent / (sent + failed)) * 100).toFixed(1)) : null,
      breaker,
    }
  }
  const health = diag.patch.inbound && diag.sdkError == null ? 'ok' : (diag.sdkError ? 'bad' : 'warn')
  return {
    mode,
    connected: !!diag.patch.inbound,
    endpoint: 'tencent-official',
    account: { uin: null, nickname: '' },
    lastEventAt: 0,
    reconnects: 0,
    lastError: diag.sdkError ?? lastError,
    patch: { ...diag.patch },
    sdkVersion: diag.sdkVersion,
    health,
    capabilities: caps,
    hooked: tencentHooked,
  }
}

export { onebot }
