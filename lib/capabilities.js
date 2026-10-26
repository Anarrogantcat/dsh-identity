/**
 * 能力位：由通道模式决定（官方拿不到的，在官方模式里就是不支持）
 *
 * 原则：缺能力 → 整块跳过 + 审计，不做半截执行。
 */
import { loadConfig } from './config.js'
import { audit } from './store.js'

export const CAPS = {
  tencent: {
    groupAllMessages: false,
    groupCard: false,
    memberList: false,
    recallEvent: false,
    pokeEvent: false,
    mergedForwardIn: false,
    reactionEvent: false,
    quoteOut: false,
    voiceOut: true,
    fileOut: true,
    videoOut: false,
    groupAdmin: true,
    realUsage: true,
    stt: false,
    roster: false,
  },
  onebot: {
    groupAllMessages: true,
    groupCard: true,
    memberList: true,
    recallEvent: true,
    pokeEvent: true,
    mergedForwardIn: true,
    reactionEvent: true,
    quoteOut: true,
    voiceOut: true,
    fileOut: true,
    videoOut: true,
    groupAdmin: true,
    realUsage: true,
    stt: true,
    roster: true,
  },
}

export const CAP_LABELS = {
  groupAllMessages: '群全量消息',
  groupCard: '群名片',
  memberList: '群成员列表',
  recallEvent: '撤回事件',
  pokeEvent: '戳一戳',
  mergedForwardIn: '合并转发',
  reactionEvent: '表情回应',
  quoteOut: '引用回复',
  voiceOut: '语音发送',
  fileOut: '文件发送',
  videoOut: '视频发送',
  groupAdmin: '群管理',
  realUsage: '真实用量',
  stt: '语音转写',
  roster: '名册（群/好友列表）',
}

export function modeOf(cfg) {
  const m = String(cfg?.transport?.mode ?? 'tencent')
  return m === 'onebot' ? 'onebot' : 'tencent'
}

export function capsOf(cfg) {
  return CAPS[modeOf(cfg)] ?? CAPS.tencent
}

export function has(cap, cfg) {
  return capsOf(cfg ?? loadConfig())[cap] === true
}

/** 缺能力时整块跳过（并记审计），不做部分执行 */
export function guardCap(cap, fn, cfg) {
  return (...args) => {
    if (!has(cap, cfg)) {
      try { audit('capability.skip', { cap, mode: modeOf(cfg ?? loadConfig()) }) } catch { /* ignore */ }
      return { skipped: true, reason: '当前模式不支持 ' + cap }
    }
    return fn(...args)
  }
}

/** 面板/启动日志用 */
export function capabilitySummary(cfg) {
  const mode = modeOf(cfg)
  const caps = capsOf(cfg)
  const all = Object.keys(CAP_LABELS)
  const available = all.filter((k) => caps[k])
  const missing = all.filter((k) => !caps[k])
  return { mode, total: all.length, available, missing, missingLabels: missing.map((k) => CAP_LABELS[k]) }
}
