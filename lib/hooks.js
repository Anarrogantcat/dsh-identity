/**
 * 挂钩装配（S5/S7 的接缝）
 *
 * 认知四张卡、关系图、离线巩固、安全熔断都由独立模块提供；
 * 这里把「通道事件」翻译成对这些模块的调用，模块缺失时静默降级（不硬依赖）。
 */
import { audit, peerKey as pkOf } from './store.js'

const errText = (err) => String(err?.message ?? err).slice(0, 160)

/** 认知模块按需加载一次；缺了就返回 null，不抛 */
export async function loadCognition(logger = console) {
  const mods = { relations: null, cards: null, digest: null, safety: null }
  for (const [key, file] of [['relations', './relations.js'], ['cards', './cards.js'], ['digest', './digest.js'], ['safety', './safety.js']]) {
    try { mods[key] = await import(file) } catch (err) {
      logger.warn?.('[qqbot-refine] 可选模块 ' + key + ' 未加载：' + errText(err))
      mods[key] = null
    }
  }
  return mods
}

export function createHooks({ mods, getConfig, logger = console, saveConfig = null }) {
  const call = (mod, fn, ...args) => {
    try {
      const m = mods?.[mod]
      if (!m || typeof m[fn] !== 'function') return undefined
      return m[fn](...args)
    } catch (err) {
      logger.warn?.('[qqbot-refine] ' + mod + '.' + fn + ' 失败：' + errText(err))
      return undefined
    }
  }

  return {
    onUserMessage(peerKey, norm) {
      call('relations', 'recordInteraction', peerKey, norm.sender, { name: norm.senderName, kind: 'msg' })
      call('digest', 'note', peerKey, { sender: norm.sender, name: norm.senderName, text: norm.content, at: Date.now() })
    },
    onBotMessage(peerKey, text) {
      call('cards', 'noteSelf', peerKey, text)
      call('digest', 'note', peerKey, { sender: 'self', name: '我', text, at: Date.now() })
    },
    onMissed(peerKey, info) {
      call('cards', 'noteMissed', peerKey, info)
    },
    onReaction(peerKey, info) {
      call('relations', 'recordInteraction', peerKey, info.uid, { kind: 'reaction' })
    },
    onPoke(info) {
      if (!info?.uid) return
      const pk = pkOf(info.groupId ? 'group' : 'c2c', info.groupId || info.uid)
      call('relations', 'recordInteraction', pk, info.uid, { kind: info.targetId ? 'poke-got' : 'poke' })
    },
    onMemberChange(info) {
      try { audit('onebot.memberChange', { group: info.groupId, kind: info.kind }) } catch { /* ignore */ }
    },
    onSendResult(ok) {
      if (!mods?.safety) return
      try {
        const cfg = getConfig?.() ?? {}
        const r = mods.safety.noteSendResult(ok, cfg)
        if (r?.tripped) {
          logger.warn?.('[qqbot-refine] 连续发送失败，进入保护模式 30 分钟')
          try { audit('safety.breaker.trip', { fails: r.fails }) } catch { /* ignore */ }
        }
      } catch { /* ignore */ }
    },
    onKicked(groupId) {
      const g = String(groupId ?? '')
      if (!g) return
      call('safety', 'noteKicked', g, '被踢出群')
      try { audit('safety.kicked', { group: g }) } catch { /* ignore */ }
      try {
        const cfg = getConfig?.() ?? {}
        if (Array.isArray(cfg.scope?.groups) && cfg.scope.groups.includes(g)) {
          cfg.scope.groups = cfg.scope.groups.filter((x) => x !== g)
          saveConfig?.(cfg)
          logger.warn?.('[qqbot-refine] 已被踢出 ' + g + '，自动从白名单摘掉')
        }
      } catch { /* ignore */ }
    },
  }
}

/** 认知四张卡 + 离线摘要：拼进人设段（每段都可缺） */
export function cognitionText(mods, peerKey, cfg = {}) {
  if (!peerKey) return ''
  const parts = []
  try {
    const c = mods?.cards?.cognitiveBlock?.(peerKey, cfg)
    if (c) parts.push(c)
  } catch { /* ignore */ }
  try {
    const d = mods?.digest?.digestOf?.(peerKey, 1)
    if (d) parts.push(d)
  } catch { /* ignore */ }
  return parts.length ? '\n\n' + parts.join('\n\n') : ''
}

/** 每 10 分钟给白名单群做一次离线巩固（本地压摘要，不花 token） */
export function consolidatePeers(mods, cfg) {
  const peers = []
  for (const g of cfg?.scope?.groups ?? []) peers.push(pkOf('group', g))
  for (const u of cfg?.scope?.dmUsers ?? []) peers.push(pkOf('c2c', u))
  for (const pk of peers) {
    try { mods?.digest?.maybeConsolidate?.(pk) } catch { /* ignore */ }
  }
  return peers.length
}
