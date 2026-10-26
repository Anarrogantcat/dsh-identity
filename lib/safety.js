/**
 * 安全档位 + 熔断 + 被踢名单（方案 §10）
 *
 * 三件事：
 *   1) 档位：safe / normal。safe=每群每小时 ≤30、每天 ≤150、间隔 ≥8s、主动关、私聊陌生人禁、图 ≤10/天
 *   2) 熔断：连续 3 次发送失败 → 保护 30 分钟（期间不再尝试发送，通知 Owner 由调用方负责）
 *   3) 被踢/被禁言：记下来，供调用方"自动摘白名单"（本模块只记状态，**不碰 settings.json**）
 *
 * 落盘：<store>/safety.json
 *   { breaker: { until:number, fails:number, reason:string },
 *     banned:  { <groupId>: { at:number, reason:string } } }
 *
 * 原则：读不到 / 读到坏数据 → 当成空状态，**绝不抛**（安全模块自己挂掉是最糟的结果）。
 */
import { join } from 'node:path'
import { readJson, writeJson, dirs, audit } from './store.js'

/** 两档预设（数值即真相，面板只改 profile 这一个旋钮） */
export const SAFETY_PROFILES = {
  safe: { perHour: 30, perDay: 150, gapSec: 8, proactive: false, dmStranger: false, imagesPerDay: 10 },
  normal: { perHour: 60, perDay: 600, gapSec: 2, proactive: true, dmStranger: true, imagesPerDay: 30 },
}

export const SAFETY_PATH = join(dirs.root, 'safety.json')

/** 连续失败几次熔断 */
export const MAX_CONSECUTIVE_FAILS = 3
/** 熔断保护时长：30 分钟 */
export const BREAKER_MS = 30 * 60 * 1000

const REASON_DEFAULT = '连续发送失败'

const emptyState = () => ({ breaker: { until: 0, fails: 0, reason: '' }, banned: {} })

/** 档位名归一：只认 safe / normal，其余（含空）一律 normal */
export function profileName(cfg) {
  const name = String(cfg?.safety?.profile ?? '').trim().toLowerCase()
  return name === 'safe' ? 'safe' : 'normal'
}

/** 按 cfg.safety.profile 取档，返回**副本**（调用方改了不会污染常量） */
export function safetyLimits(cfg) {
  const name = profileName(cfg)
  return { ...SAFETY_PROFILES[name], profile: name }
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const num0 = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0 }

/** 读状态：任何异常 / 脏数据都退化成空状态 */
function loadState() {
  const s = emptyState()
  const j = readJson(SAFETY_PATH, null)
  if (!isObj(j)) return s
  if (isObj(j.breaker)) {
    s.breaker.until = num0(j.breaker.until)
    s.breaker.fails = num0(j.breaker.fails)
    s.breaker.reason = String(j.breaker.reason ?? '')
  }
  if (isObj(j.banned)) {
    for (const [k, v] of Object.entries(j.banned)) {
      const gid = String(k ?? '').trim()
      if (!gid || !isObj(v)) continue
      s.banned[gid] = { at: num0(v.at), reason: String(v.reason ?? '') }
    }
  }
  return s
}

/** 落盘：失败只是记审计，不影响判定 */
function saveState(s) {
  try { writeJson(SAFETY_PATH, s) } catch { /* 落盘失败不阻断主流程 */ }
}

/**
 * 记一次发送结果。
 *   ok=true  → 连续失败清零
 *   ok=false → 连续失败 +1；满 3 次 → 熔断 30 分钟
 * @returns {{tripped:boolean, until:number, fails:number}}
 */
export function noteSendResult(ok, cfg) {
  void cfg // 档位目前不影响熔断阈值（方案里只有一个阈值），保留参数以便将来按档位调整
  const s = loadState()
  const now = Date.now()
  let tripped = false
  if (ok) {
    s.breaker.fails = 0
  } else {
    s.breaker.fails = s.breaker.fails + 1
    // 已经在熔断期内再失败：只累计次数，不续期、不重复触发
    if (s.breaker.fails >= MAX_CONSECUTIVE_FAILS && !(s.breaker.until > now)) {
      tripped = true
      s.breaker.until = now + BREAKER_MS
      s.breaker.reason = s.breaker.reason || REASON_DEFAULT
    }
  }
  saveState(s)
  if (tripped) {
    audit('safety', { event: 'breaker-trip', fails: s.breaker.fails, until: s.breaker.until, reason: s.breaker.reason })
  }
  return { tripped, until: s.breaker.until, fails: s.breaker.fails }
}

/** 熔断状态（过期的自动关闭并落盘） */
export function breakerState(now = Date.now()) {
  const s = loadState()
  if (s.breaker.until && s.breaker.until <= now) {
    s.breaker = { until: 0, fails: 0, reason: '' }
    saveState(s)
    audit('safety', { event: 'breaker-auto-close' })
  }
  const open = s.breaker.until > now
  return { open, until: open ? s.breaker.until : 0, fails: s.breaker.fails, reason: open ? s.breaker.reason : '' }
}

/** 现在是不是处于熔断中 */
export function breakerOpen(now = Date.now()) {
  return breakerState(now).open
}

/** 手动熔断（Owner 发现异常时可以直接踩刹车） */
export function tripBreaker(reason = '手动熔断', now = Date.now()) {
  const s = loadState()
  s.breaker.until = now + BREAKER_MS
  s.breaker.fails = Math.max(s.breaker.fails, MAX_CONSECUTIVE_FAILS)
  s.breaker.reason = String(reason ?? '') || '手动熔断'
  saveState(s)
  audit('safety', { event: 'breaker-manual-trip', until: s.breaker.until, reason: s.breaker.reason })
  return breakerState(now)
}

/** 手动解除熔断 */
export function resetBreaker(now = Date.now()) {
  const s = loadState()
  s.breaker = { until: 0, fails: 0, reason: '' }
  saveState(s)
  audit('safety', { event: 'breaker-reset' })
  return breakerState(now)
}

/**
 * 记一次「被踢 / 被禁言」。
 * 本模块只记状态，摘白名单由调用方决定（config 不在这里动）。
 * @returns {{ok:boolean, groupId:string, at:number, reason:string}}
 */
export function noteKicked(groupId, reason) {
  const gid = String(groupId ?? '').trim()
  if (!gid) return { ok: false, groupId: '', at: 0, reason: '' }
  const s = loadState()
  const at = Date.now()
  const why = String(reason ?? '').slice(0, 80) || '被踢/被禁言'
  s.banned[gid] = { at, reason: why }
  saveState(s)
  audit('safety', { event: 'kicked', groupId: gid, reason: why })
  return { ok: true, groupId: gid, at, reason: why }
}

/** 被踢 / 被禁言的群（新→旧） */
export function bannedGroups() {
  const s = loadState()
  return Object.entries(s.banned)
    .map(([groupId, v]) => ({ groupId, at: v.at, reason: v.reason }))
    .sort((a, b) => b.at - a.at)
}

export function isBannedGroup(groupId) {
  const gid = String(groupId ?? '').trim()
  if (!gid) return false
  return Object.prototype.hasOwnProperty.call(loadState().banned, gid)
}

/** 解除（比如 Owner 确认已经重新拉回群里了） */
export function unbanGroup(groupId) {
  const gid = String(groupId ?? '').trim()
  if (!gid) return { ok: false, removed: false, groupId: '' }
  const s = loadState()
  const removed = Object.prototype.hasOwnProperty.call(s.banned, gid)
  if (removed) {
    delete s.banned[gid]
    saveState(s)
    audit('safety', { event: 'unban', groupId: gid })
  }
  return { ok: true, removed, groupId: gid }
}
