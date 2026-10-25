/** 运行时状态：冷却、每分钟计数、闭麦、配额、去重（内存 + 轻量落盘） */
import { join } from 'node:path'
import { readJson, writeJson, dirs } from './store.js'

const STATE_PATH = join(dirs.root, 'state.json')

export const state = {
  muted: {}, // groupOpenid -> { until, by, reason }
  cooldown: {}, // key -> ts
  windows: {}, // key -> number[]
  counters: {}, // key -> { day, n }
  dedupe: {}, // stickerId -> ts
  muteCalls: {}, // groupId -> number[]（Admin 每小时闭麦次数）
  seen: [], // 最近出现过的来源（被拦截时记录，面板用于「加白名单」）
  bindCode: null,
  spokeAt: {}, // 群 -> 她上次发言时间（自然接话用）
  lastMsg: {}, // 群 -> 最后一条消息时间（主动搭话用）
  lastProactive: {}, // 群 -> 上次主动时间 // { code, purpose, expiresAt }
  bindFail: {}, // openid -> { n, until }
  nm: {}, // 群 -> { n, at } 非@消息计数（用于「每 N 条回一次」）
}

export function loadState() {
  const saved = readJson(STATE_PATH, null)
  if (saved) Object.assign(state, saved)
}

let saveTimer = null
export function saveStateSoon() {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    try { writeJson(STATE_PATH, state) } catch { /* ignore */ }
  }, 800)
}

const DAY = 86400000
const now = () => Date.now()

// ── 冷却 ──
export function cooldownPass(key, sec) {
  if (!sec) return true
  const last = state.cooldown[key] ?? 0
  if (now() - last < sec * 1000) return false
  state.cooldown[key] = now()
  saveStateSoon()
  return true
}

// ── 滑动窗口 ──
export function ratePass(key, max, windowMs = 60000) {
  if (!max) return true
  const arr = (state.windows[key] ?? []).filter((t) => now() - t < windowMs)
  if (arr.length >= max) {
    state.windows[key] = arr
    return false
  }
  arr.push(now())
  state.windows[key] = arr
  saveStateSoon()
  return true
}

// ── 每日计数 ──
export function dayCountPass(key, max) {
  if (!max) return true
  const today = new Date().toISOString().slice(0, 10)
  const c = state.counters[key]
  if (!c || c.day !== today) {
    state.counters[key] = { day: today, n: 1 }
    saveStateSoon()
    return true
  }
  if (c.n >= max) return false
  c.n += 1
  saveStateSoon()
  return true
}

// ── 闭麦 ──
export function setMute(groupId, ms, by, reason = '') {
  state.muted[groupId] = { until: now() + ms, by, reason }
  saveStateSoon()
}

export function clearMute(groupId) {
  delete state.muted[groupId]
  saveStateSoon()
}

export function muteInfo(groupId) {
  const m = state.muted[groupId]
  if (!m) return null
  if (m.until <= now()) {
    delete state.muted[groupId]
    saveStateSoon()
    return null
  }
  return { ...m, remainMs: m.until - now() }
}

export function muteCallsAllowed(groupId, maxPerHour) {
  if (!maxPerHour) return true
  const arr = (state.muteCalls[groupId] ?? []).filter((t) => now() - t < 3600000)
  if (arr.length >= maxPerHour) return false
  arr.push(now())
  state.muteCalls[groupId] = arr
  saveStateSoon()
  return true
}

// ── 表情包去重 ──
export function dedupePass(id, hours) {  if (!hours) return true
  const t = state.dedupe[id]
  if (t && now() - t < hours * 3600000) return false
  state.dedupe[id] = now()
  // 顺手清理过期项，防止无限膨胀
  const limit = now() - 7 * DAY
  for (const [k, v] of Object.entries(state.dedupe)) if (v < limit) delete state.dedupe[k]
  saveStateSoon()
  return true
}

// ── 最近来源（被拦截时记录，用于面板一键加白名单）──
export function recordSeen(f) {
  try {
    const at = new Date().toISOString()
    const key = `${f.scope}:${f.peer}:${f.sender}`
    const rest = (state.seen ?? []).filter((x) => x.key !== key)
    state.seen = [{ at, scope: f.scope, peer: f.peer, sender: f.sender, key }, ...rest].slice(0, 20)
    saveStateSoon()
  } catch { /* ignore */ }
}

// ── 绑定码（一次性，绕过"没人知道 openid"的死循环）──
export function newBind(purpose = 'owner', ttlMin = 10) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)]
  state.bindCode = { code, purpose, expiresAt: Date.now() + Math.min(60, Math.max(1, ttlMin)) * 60000 }
  saveStateSoon()
  return state.bindCode
}
export function getBind() {
  const b = state.bindCode
  if (!b) return null
  if (b.expiresAt <= Date.now()) { delete state.bindCode; saveStateSoon(); return null }
  return b
}
export function clearBind() { delete state.bindCode; saveStateSoon() }
export function bindFailHit(openid) {
  const now = Date.now()
  const rec = state.bindFail[openid] ?? { n: 0, until: 0 }
  if (rec.until && now < rec.until) return { locked: true, until: rec.until }
  rec.n += 1
  if (rec.n >= 3) { rec.until = now + 10 * 60000; rec.n = 0 }
  state.bindFail[openid] = rec
  saveStateSoon()
  return { locked: false }
}

// ── 非 @ 消息计数：每 N 条放行一次 ──
export function nmHit(key, windowMs = 600000) {
  const now = Date.now()
  const rec = state.nm[key]
  if (!rec || now - rec.at > windowMs) {
    state.nm[key] = { n: 1, at: now }
    saveStateSoon()
    return 1
  }
  rec.n += 1
  rec.at = now
  saveStateSoon()
  return rec.n
}
export function nmReset(key) { delete state.nm[key]; saveStateSoon() }

// ── 她说过的时刻（自然接话：自己刚说完就先不接）──
export function markSpoke(key) {
  state.spokeAt[key] = Date.now()
  saveStateSoon()
}
export function lastSpoke(key) {
  return state.spokeAt[key] ?? 0
}

// ── 最后消息 / 上次主动（主动搭话用）──
export function touchLastMsg(key) { state.lastMsg[key] = Date.now(); saveStateSoon() }
export function lastMsgAt(key) { return state.lastMsg[key] ?? 0 }
export function markProactive(key) { state.lastProactive[key] = Date.now(); saveStateSoon() }
export function lastProactiveAt(key) { return state.lastProactive[key] ?? 0 }
