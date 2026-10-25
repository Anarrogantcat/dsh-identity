/**
 * 真实 token 用量 + 折算金额
 *
 * 数据来源：DSH 自己的会话快照
 *   <DSH_HOME>/storages/session_projcache/sessions/<sessionId>.json
 *   record.rows.tokenUsage.val.totals = { uncachedInputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }
 *
 * QQ 群的 sessionId 可以用 sessionIdFor(appId, 'group', groupOpenid) 推出来（和 dsh-qqbot 一致，已验证）。
 * 这些 totals 是**累计值**，所以每天第一次读时把当时的累计值记成基线，今天的花费 = 当前 - 基线。
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { DSH_HOME } from './config.js'
import { readJson, writeJson, dirs } from './store.js'
import { readCredentials } from './api.js'
import { createHash } from 'node:crypto'

const SESS_DIR = join(DSH_HOME, 'storages', 'session_projcache', 'sessions')
const BASE_PATH = join(dirs.root, 'usage.json')

/** 默认价（元 / 百万 tokens）：DeepSeek 公开价，可在面板改 */
export const DEFAULT_PRICES = { inputMiss: 2, inputHit: 0.2, output: 3 }

export const EMPTY = { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }

/** 和 dsh-qqbot / persona.js 一致的会话 id 推导（同步版，避免 await） */
export function sidFor(appId, scope, peer) {
  if (!appId) return null
  const h = createHash('sha256').update(`qqbot:${appId}:${scope}:${peer}`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}

export function sessionFile(sid) {
  return join(SESS_DIR, `${sid}.json`)
}

/** 读某个会话的累计用量；没有就返回 null */
export function sessionTotals(sid) {
  try {
    const p = sessionFile(sid)
    if (!existsSync(p)) return null
    const j = JSON.parse(readFileSync(p, 'utf8'))
    const t = j?.record?.rows?.tokenUsage?.val?.totals
    if (!t) return null
    return {
      uncachedInputTokens: Number(t.uncachedInputTokens ?? 0),
      outputTokens: Number(t.outputTokens ?? 0),
      cacheReadTokens: Number(t.cacheReadTokens ?? 0),
      cacheWriteTokens: Number(t.cacheWriteTokens ?? 0),
    }
  } catch { return null }
}

export function tokensOf(t) {
  const x = { ...EMPTY, ...(t ?? {}) }
  return {
    input: x.uncachedInputTokens + x.cacheWriteTokens,
    output: x.outputTokens,
    hit: x.cacheReadTokens,
    total: x.uncachedInputTokens + x.cacheWriteTokens + x.outputTokens + x.cacheReadTokens,
  }
}

/** 折算成元；prices 单位是「元 / 百万 tokens」 */
export function costOf(t, prices = DEFAULT_PRICES) {
  const p = { ...DEFAULT_PRICES, ...(prices ?? {}) }
  const x = { ...EMPTY, ...(t ?? {}) }
  const yuan =
    ((x.uncachedInputTokens + x.cacheWriteTokens) / 1e6) * Number(p.inputMiss ?? 0) +
    (x.cacheReadTokens / 1e6) * Number(p.inputHit ?? 0) +
    (x.outputTokens / 1e6) * Number(p.output ?? 0)
  return Number(yuan.toFixed(4))
}

export function pricesOf(cfg) {
  const u = cfg?.usage ?? {}
  return {
    inputMiss: Number(u.priceInputMiss ?? DEFAULT_PRICES.inputMiss),
    inputHit: Number(u.priceInputHit ?? DEFAULT_PRICES.inputHit),
    output: Number(u.priceOutput ?? DEFAULT_PRICES.output),
  }
}

const todayStr = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function loadBase() {
  const j = readJson(BASE_PATH, null)
  if (!j || typeof j !== 'object') return { date: todayStr(), peers: {} }
  j.peers ??= {}
  return j
}

/**
 * 今日增量：把「当天第一次看到的累计值」钉成基线，之后一直跟它比。
 * 注意：基线只在当天首次出现时写一次，重复读不会推进基线（否则每读一次就清零一次）。
 */
export function todayDelta(sid, totals) {
  if (!totals) return { ...EMPTY }
  const db = loadBase()
  const today = todayStr()
  if (db.date !== today) { db.date = today; db.peers = {} }
  let b = db.peers[sid]
  if (!b) {
    b = { ...totals }
    db.peers[sid] = b
    writeJson(BASE_PATH, db)
    return { ...EMPTY }
  }
  return {
    uncachedInputTokens: Math.max(0, totals.uncachedInputTokens - (b.uncachedInputTokens ?? 0)),
    outputTokens: Math.max(0, totals.outputTokens - (b.outputTokens ?? 0)),
    cacheReadTokens: Math.max(0, totals.cacheReadTokens - (b.cacheReadTokens ?? 0)),
    cacheWriteTokens: Math.max(0, totals.cacheWriteTokens - (b.cacheWriteTokens ?? 0)),
  }
}

/** 汇总：按群/私聊，今日 token + 金额；拿不到凭证或快照就返回空表 */
export function usageReport(cfg) {
  const prices = pricesOf(cfg)
  const creds = (() => { try { return readCredentials() } catch { return null } })()
  const appId = creds?.appId ?? null
  const rows = []
  const totals = { input: 0, output: 0, hit: 0, total: 0, yuan: 0 }
  /** 会话累计（不限今天），给面板做对照 */
  const all = { input: 0, output: 0, hit: 0, total: 0, yuan: 0 }
  if (!appId) return { ok: false, error: '没有 appId，无法定位 QQ 会话', prices, rows, totals, all }
  const targets = [
    ...(cfg?.scope?.groups ?? []).map((g) => ({ scope: 'group', peer: g })),
    ...(cfg?.scope?.dmUsers ?? []).map((u) => ({ scope: 'c2c', peer: u })),
  ]
  for (const t of targets) {
    const sid = sidFor(appId, t.scope, t.peer)
    if (!sid) continue
    const now = sessionTotals(sid)
    if (!now) continue
    const delta = todayDelta(sid, now)
    const tk = tokensOf(delta)
    const yuan = costOf(delta, prices)
    rows.push({ scope: t.scope, peer: t.peer, sid, tokens: tk, yuan })
    totals.input += tk.input
    totals.output += tk.output
    totals.hit += tk.hit
    totals.total += tk.total
    totals.yuan = Number((totals.yuan + yuan).toFixed(4))
    const ak = tokensOf(now)
    all.input += ak.input
    all.output += ak.output
    all.hit += ak.hit
    all.total += ak.total
    all.yuan = Number((all.yuan + costOf(now, prices)).toFixed(4))
  }
  return { ok: true, prices, rows, totals, all }
}

export function resetToday() {
  const db = loadBase()
  db.date = todayStr()
  db.peers = {}
  writeJson(BASE_PATH, db)
  return true
}
