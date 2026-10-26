/**
 * 通道抽象：由 transport.mode 决定用哪条通道（单活，不共存）
 *
 *   tencent —— 包 @tencent-connect/dsh-qqbot 的 QQBot.prototype（现有行为）
 *   onebot  —— 连 NapCat 的 websocketServers（事件与 API），消息通道仍由 dsh-onebot 负责
 */
import { loadConfig } from './config.js'
import { modeOf, capabilitySummary } from './capabilities.js'
import { OneBotClient } from './onebot-client.js'
import { diag, loadQQBot, installHooks } from './diag.js'

let onebot = null
let tencentHooked = false
let lastError = ''

export function getOneBotClient(cfg = loadConfig()) {
  const url = String(cfg?.transport?.onebot?.url ?? '')
  const token = String(cfg?.transport?.onebot?.token ?? '')
  if (!url) return null
  if (onebot && onebot.url === url && onebot.token === token) return onebot
  try { onebot?.stop() } catch { /* ignore */ }
  onebot = new OneBotClient({ url, token })
  return onebot
}

export async function startTransport(gate, logger = console) {
  const cfg = loadConfig()
  const mode = modeOf(cfg)
  if (mode === 'onebot') {
    const client = getOneBotClient(cfg)
    if (client) {
      client.start()
      logger.info?.('[qqbot-refine] 通道=onebot，正在连 ' + client.url)
    } else {
      lastError = 'transport.onebot.url 未配置'
      logger.warn?.('[qqbot-refine] 通道=onebot 但没配 WS 地址')
    }
    return { mode, hooked: false }
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
    return { mode, ...d, health, capabilities: caps, hooked: false }
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
