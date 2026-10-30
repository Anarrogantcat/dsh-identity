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
export const DEFAULT_PRICES = { inputMiss: 2, inputHit: 0.04, output: 8, calibFactor: 0.15 }

export const EMPTY = { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }

/** 和 dsh-qqbot / persona.js 一致的会话 id 推导（同步版，避免 await） */
export function sidFor(appId, scope, peer) {
  if (!appId) return null
  const h = createHash('sha256').update(`qqbot:${appId}:${scope}:${peer}`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}

/** OneBot 通道的会话 id 命名空间（必须与 lib/onebot-channel.js 里的 NS 完全一致） */
export const ONEBOT_NS = 'qqbot-refine:onebot'

/**
 * OneBot 通道的会话 id：与 lib/onebot-channel.js 的 sessionIdFor(scope, peer) **逐字节一致**。
 *
 * 为什么重算一份而不是 import onebot-channel.js：
 *   · 那边会拉进 roster / persona / 宿主服务等一整串依赖，面板侧（mgmt）和量用查询不该被牵连；
 *   · 规则只有一行（sha256(NS:scope:peer) → uuid 形态），复制比多一条依赖便宜。
 * 来源：lib/onebot-channel.js 的 `sessionIdFor`（NS = 'qqbot-refine:onebot'）。
 * 改规则时两边必须一起改（%TEMP%\usage-onebot-test.mjs 会直接对比两者输出）。
 */
export function sidForOneBot(scope, peer) {
  // 会话冲突时 onebot 会轮换 sid，存在 sidmap.json；用量统计必须跟着走
  try {
    const map = readJson(join(dirs.root, 'sidmap.json'), {})
    const hit = map && map[`${scope}:${peer}`]
    if (hit) return String(hit)
  } catch { /* ignore */ }
  const h = createHash('sha256').update(`${ONEBOT_NS}:${scope}:${peer}`).digest('hex')
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
  const calib = Number.isFinite(Number(p.calibFactor)) && Number(p.calibFactor) > 0 ? Number(p.calibFactor) : 1
  const x = { ...EMPTY, ...(t ?? {}) }
  const yuan =
    ((x.uncachedInputTokens + x.cacheWriteTokens) / 1e6) * Number(p.inputMiss ?? 0) +
    (x.cacheReadTokens / 1e6) * Number(p.inputHit ?? 0) +
    (x.outputTokens / 1e6) * Number(p.output ?? 0)
  return Number((yuan * calib).toFixed(4))
}

export function pricesOf(cfg) {
  const u = cfg?.usage ?? {}
  return {
    inputMiss: Number(u.priceInputMiss ?? DEFAULT_PRICES.inputMiss),
    inputHit: Number(u.priceInputHit ?? DEFAULT_PRICES.inputHit),
    output: Number(u.priceOutput ?? DEFAULT_PRICES.output),
    calibFactor: Number(u.calibFactor ?? DEFAULT_PRICES.calibFactor ?? 1),
  }
}

/**
 * 空闲价（元 / 百万 tokens）：
 *   · 面板填了「空闲价：…」就按填的算
 *   · 没填（0/空）就按峰价 × 谷时计价系数（默认 0.5）
 * 这样既能一键半价，也能在官方调价时把两套价分开写清楚。
 */
export function offPeakPricesOf(cfg) {
  const u = cfg?.usage ?? {}
  const p = pricesOf(cfg)
  const f = Number(u.priceOffPeakFactor ?? 0.5)
  const factor = Number.isFinite(f) && f > 0 ? f : 0.5
  const pick = (key, base) => {
    const v = Number(u[key])
    return Number.isFinite(v) && v > 0 ? v : Number((Number(base) * factor).toFixed(6))
  }
  return {
    inputMiss: pick('priceOffPeakInputMiss', p.inputMiss),
    inputHit: pick('priceOffPeakInputHit', p.inputHit),
    output: pick('priceOffPeakOutput', p.output),
    calibFactor: p.calibFactor,
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
  if (db.date !== today) {
    db.date = today
    db.peers = {}
    // 用上次采样的累计做昨日基线；没有就当新会话，从 0 起算
    try { db.latest = db.latest || (readJson(BUCKET_PATH, {}).last || {}) } catch { /* ignore */ }
  }
  let b = db.peers[sid]
  if (!b) {
    // 轮换过的会话（sidmap 记录）从 0 起算；普通会话沿用「首次见到的累计值」当基线
    let rotated = false
    try { const sm = readJson(join(dirs.root, 'sidmap.json'), {}); rotated = Object.values(sm || {}).includes(String(sid)) } catch { /* ignore */ }
    b = rotated ? { ...EMPTY } : { ...totals }
    db.peers[sid] = b
  }
  db.latest ??= {}
  db.latest[sid] = { ...totals }
  writeJson(BASE_PATH, db)
  return {
    uncachedInputTokens: Math.max(0, totals.uncachedInputTokens - (b.uncachedInputTokens ?? 0)),
    outputTokens: Math.max(0, totals.outputTokens - (b.outputTokens ?? 0)),
    cacheReadTokens: Math.max(0, totals.cacheReadTokens - (b.cacheReadTokens ?? 0)),
    cacheWriteTokens: Math.max(0, totals.cacheWriteTokens - (b.cacheWriteTokens ?? 0)),
  }
}

const zeroTotals = () => ({ input: 0, output: 0, hit: 0, total: 0, yuan: 0 })


const LIFETIME_PATH = join(dirs.root, 'usage-total.json')
/** 自记账起的总累计：按会话上次快照做增量，历史不补 */
function lifetimeAdd(sid, now, prices) {
  const db = readJson(LIFETIME_PATH, null) || { total: zeroTotals(), last: {} }
  db.total = db.total || zeroTotals()
  db.last = db.last || {}
  const prev = db.last[sid]
  db.last[sid] = { ...now }
  {
    const d = {
      uncachedInputTokens: Math.max(0, now.uncachedInputTokens - (prev?.uncachedInputTokens ?? 0)),
      outputTokens: Math.max(0, now.outputTokens - (prev?.outputTokens ?? 0)),
      cacheReadTokens: Math.max(0, now.cacheReadTokens - (prev?.cacheReadTokens ?? 0)),
      cacheWriteTokens: Math.max(0, now.cacheWriteTokens - (prev?.cacheWriteTokens ?? 0)),
    }
    d.uncachedInputTokens = prev ? d.uncachedInputTokens : now.uncachedInputTokens
    d.outputTokens = prev ? d.outputTokens : now.outputTokens
    d.cacheReadTokens = prev ? d.cacheReadTokens : now.cacheReadTokens
    d.cacheWriteTokens = prev ? d.cacheWriteTokens : now.cacheWriteTokens
    const tk = tokensOf(d)
    db.total.input += tk.input
    db.total.output += tk.output
    db.total.hit += tk.hit
    db.total.total += tk.total
    db.total.yuan += costOf(d, prices)
  }
  writeJson(LIFETIME_PATH, db)
  return { ...db.total, yuan: Number(db.total.yuan.toFixed(4)) }
}

/**
 * 汇总核心：通道无关。
 * @param {(scope:string, peer:string) => (string|null)} sidOf 会话 id 推导（tencent / onebot 各一份）
 * @param {string} dmScope 私聊的 scope 名（两条通道都是 'c2c'）
 */
function summarize(cfg, sidOf, dmScope, mode) {
  const prices = pricesOf(cfg)
  const rows = []
  const totals = zeroTotals()
  /** 会话累计（不限今天），给面板做对照 */
  const all = zeroTotals()
  let lifetime = zeroTotals()
  const targets = [
    ...(cfg?.scope?.groups ?? []).map((g) => ({ scope: 'group', peer: String(g) })),
    ...(cfg?.scope?.dmUsers ?? []).map((u) => ({ scope: dmScope, peer: String(u) })),
  ]
  for (const t of targets) {
    let sid = null
    try { sid = sidOf(t.scope, t.peer) } catch { sid = null }
    if (!sid) continue
    const now = sessionTotals(sid)
    if (!now) continue
    const delta = todayDelta(sid, now)
    const lt = lifetimeAdd(sid, now, prices)
    lifetime = { ...lt }
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
  return { mode, prices, rows, totals, all, lifetime }
}

/** OneBot 通道：会话 id 不需要 appId，直接用 (scope, peer) 派生 */
/** 按 DSH 会话记录汇总聊天累计（保留的会话；已删/归档的补不回） */
export function chatTotals(cfg) {
  const prices = pricesOf(cfg)
  const totals = zeroTotals()
  let sessions = 0
  try {
    for (const f of readdirSync(SESS_DIR)) {
      if (!f.endsWith('.json')) continue
      // 只算 QQ 插件会话：会话 id 是 UUID；web/DSH 的 session-* 不算
      if (String(f).startsWith('session-')) continue
      try {
        const j = JSON.parse(readFileSync(join(SESS_DIR, f), 'utf8'))
        const t = j?.record?.rows?.tokenUsage?.val?.totals
        if (!t) continue
        sessions += 1
        for (const k of ['uncachedInputTokens','outputTokens','cacheReadTokens','cacheWriteTokens']) totals[k] += Number(t[k] || 0)
      } catch { /* skip broken */ }
    }
  } catch { /* no cache */ }
  const tk = tokensOf(totals)
  return { sessions, tokens: tk.total, input: tk.input, output: tk.output, hit: tk.hit, yuan: Number(costOf(totals, prices).toFixed(2)) }
}

export function usageReportOneBot(cfg) {
  const r = summarize(cfg, sidForOneBot, 'c2c', 'onebot')
  try { r.chatTotal = chatTotals(cfg) } catch { /* ignore */ }
  return { ok: true, ...r }
}

/** 汇总：按群/私聊，今日 token + 金额；拿不到凭证或快照就返回空表 */
export function usageReport(cfg) {
  // 通道单活：onebot 走自建通道的会话 id 规则，tencent 仍要 appId
  if (String(cfg?.transport?.mode ?? '').toLowerCase() === 'onebot') return usageReportOneBot(cfg)
  const prices = pricesOf(cfg)
  const creds = (() => { try { return readCredentials() } catch { return null } })()
  const appId = creds?.appId ?? null
  if (!appId) {
    return {
      ok: false, mode: 'tencent', error: '没有 appId，无法定位 QQ 会话',
      prices, rows: [], totals: zeroTotals(), all: zeroTotals(),
    }
  }
  return { ok: true, ...summarize(cfg, (scope, peer) => sidFor(appId, scope, peer), 'c2c', 'tencent') }
}

export function resetToday() {
  const db = loadBase()
  db.date = todayStr()
  db.peers = {}
  writeJson(BASE_PATH, db)
  return true
}

// ── 峰谷计价 + 搜索计价（按 5 分钟采样归桶，历史无法回溯，只能从现在开始记）──
const BUCKET_PATH = join(dirs.root, 'usage-buckets.json')

/**
 * 现在是高峰还是空闲（DeepSeek 官方）：
 *   高峰 = 北京时间周一至周五 9:00-12:00、14:00-18:00（法定节假日除外）
 *   其余时段（含夜晚、周末、节假日）为空闲，价格是高峰的一半
 */
export function bucketNow(cfg, now = Date.now()) {
  const u = cfg?.usage ?? {}
  const bj = new Date(now + 8 * 3600 * 1000)
  const day = bj.getUTCDay() // 0=周日
  const dateStr = bj.toISOString().slice(0, 10)
  const holidays = Array.isArray(u.holidays) ? u.holidays.map(String) : []
  if (u.peakOnlyWeekdays !== false && (day === 0 || day === 6)) return 'offpeak'
  if (holidays.includes(dateStr)) return 'offpeak'
  const windows = Array.isArray(u.peakWindows) && u.peakWindows.length ? u.peakWindows : ['09:00-12:00', '14:00-18:00']
  const mins = bj.getUTCHours() * 60 + bj.getUTCMinutes()
  const toMin = (s) => { const [h, m] = String(s).split(':').map(Number); return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0) }
  for (const w of windows) {
    const [a, b] = String(w).split('-')
    if (!a || !b) continue
    const s2 = toMin(a), e2 = toMin(b)
    if (mins >= s2 && mins < e2) return 'peak'
  }
  return 'offpeak'
}
function loadBuckets() {
  const j = readJson(BUCKET_PATH, null)
  if (!j || typeof j !== 'object') return { date: todayStr(), buckets: {}, last: {}, search: 0 }
  j.buckets ??= {}
  j.last ??= {}
  const today = todayStr()
  if (j.date !== today) { j.date = today; j.buckets = {}; j.search = 0 }
  return j
}

/** 采样：把「自上次采样以来的增量」记进当前时段桶 */
export function sampleBuckets(cfg, sidOf, targets, now = Date.now()) {
  const db = loadBuckets()
  const bucket = bucketNow(cfg, now)
  let changed = false
  for (const t2 of targets) {
    let sid = null
    try { sid = sidOf(t2.scope, t2.peer) } catch { sid = null }
    if (!sid) continue
    const nowT = sessionTotals(sid)
    if (!nowT) continue
    const prev = db.last[sid]
    db.last[sid] = { ...nowT }
    if (!prev) { changed = true; continue }
    const d = {
      uncachedInputTokens: Math.max(0, nowT.uncachedInputTokens - (prev.uncachedInputTokens ?? 0)),
      outputTokens: Math.max(0, nowT.outputTokens - (prev.outputTokens ?? 0)),
      cacheReadTokens: Math.max(0, nowT.cacheReadTokens - (prev.cacheReadTokens ?? 0)),
      cacheWriteTokens: Math.max(0, nowT.cacheWriteTokens - (prev.cacheWriteTokens ?? 0)),
    }
    if (!d.uncachedInputTokens && !d.outputTokens && !d.cacheReadTokens && !d.cacheWriteTokens) continue
    const b = db.buckets[bucket] ?? (db.buckets[bucket] = { input: 0, output: 0, hit: 0 })
    b.input += d.uncachedInputTokens + d.cacheWriteTokens
    b.output += d.outputTokens
    b.hit += d.cacheReadTokens
    changed = true
  }
  if (changed) writeJson(BUCKET_PATH, db)
  return db
}

/** 记一次联网搜索（web_search 工具调用成功时） */
export function recordSearch(n = 1) {
  try {
    const db = loadBuckets()
    db.search = Number(db.search ?? 0) + Math.max(0, Number(n) || 0)
    writeJson(BUCKET_PATH, db)
  } catch { /* ignore */ }
}

export function bucketsReport(cfg) {
  const db = loadBuckets()
  const u = cfg?.usage ?? {}
  const prices = pricesOf(cfg)
  const offPrices = offPeakPricesOf(cfg)
  const off = Number(u.priceOffPeakFactor ?? 0.5)
  const searchPrice = Number(u.priceSearch ?? 0.005)
  const calib = Number(prices.calibFactor ?? 1)
  const costOfBucket = (b, p) => {
    if (!b) return 0
    return (b.input / 1e6) * Number(p.inputMiss) + (b.hit / 1e6) * Number(p.inputHit) + (b.output / 1e6) * Number(p.output)
  }
  const peak = db.buckets.peak ?? { input: 0, output: 0, hit: 0 }
  const offp = db.buckets.offpeak ?? { input: 0, output: 0, hit: 0 }
  const peakCost = costOfBucket(peak, prices) * calib
  const offCost = costOfBucket(offp, offPrices) * calib
  const freeUntil = Date.parse(String(u.searchFreeUntil ?? '2026-11-01T00:00:00+08:00'))
  const searchFree = Number.isFinite(freeUntil) && Date.now() < freeUntil
  const searchCost = searchFree ? 0 : Number(db.search ?? 0) * searchPrice
  return {
    peak, offpeak: offp, search: Number(db.search ?? 0),
    peakCost: Number(peakCost.toFixed(4)),
    offpeakCost: Number(offCost.toFixed(4)),
    searchCost: Number(searchCost.toFixed(4)),
    total: Number((peakCost + offCost + searchCost).toFixed(4)),
    offPeakFactor: off, offPeakPrices: offPrices, prices, searchPrice, calib, searchFree,
    bucketNow: bucketNow(cfg),
  }
}

/** 按当前通道模式决定 sid 推导 */
export function sidOfForConfig(cfg) {
  const mode = String(cfg?.transport?.mode ?? 'onebot')
  if (mode === 'onebot') return sidForOneBot
  const appId = String(cfg?.transport?.tencent?.appId ?? '')
  return (scope, peer) => sidFor(appId, scope === 'c2c' ? 'c2c' : scope, peer)
}

/** 需要在用量里统计的会话目标 */
export function usageTargets(cfg) {
  return [
    ...(cfg?.scope?.groups ?? []).map((g) => ({ scope: 'group', peer: String(g) })),
    ...(cfg?.scope?.dmUsers ?? []).map((u) => ({ scope: 'dm', peer: String(u) })),
  ]
}

/** 会话上下文压力比（0~1）：越高越接近压缩/截断 */
export function pressureRatioOf(raw) {
  const pv = raw?.record?.rows?.contextPressure?.val ?? {}
  const used = Number(pv.pressureTokens ?? pv.surfaceTokens ?? 0)
  const win = Number(pv.contextWindow ?? 0)
  return win > 0 ? Math.min(1, used / win) : 0
}

// ── 每日预算（软）：按群 / 按私聊档位，只告警不拦 ──
/** 汇总缓存（60 秒），免得每条群消息都重读所有会话文件 */
let peerBudgetCache = { at: 0, rows: [] }

/** 这一档的预算上限：群=群预算，私聊=个人预算 */
export function limitsOf(cfg, scope) {
  const group = scope === 'group'
  const tokenLimit = group ? cfg?.usage?.groupDailyTokens : cfg?.usage?.userDailyTokens
  const yuanLimit = group ? cfg?.usage?.groupDailyYuan : cfg?.usage?.userDailyYuan
  const warnRaw = cfg?.usage?.warnRatio
  return {
    tokens: Math.max(0, Number(tokenLimit ?? 0)),
    yuan: Math.max(0, Number(yuanLimit ?? 0)),
    warnRatio: Math.min(1, Math.max(0.1, Number(warnRaw ?? 0.8))),
  }
}

/**
 * 某个 peer 今天的预算状态（token / 金额两把尺子取高的那个比例）。
 * @returns {{scope:string, peer:string, tokens:number, yuan:number,
 *            tokenLimit:number, yuanLimit:number, ratio:number, warn:boolean, over:boolean}|null}
 */
export function peerBudget(cfg, scope, peer, now = Date.now()) {
  const lim = limitsOf(cfg, scope)
  if (!lim.tokens && !lim.yuan) return null
  if (now - peerBudgetCache.at > 60000) {
    try {
      const r = usageReport(cfg)
      peerBudgetCache = { at: now, rows: r?.rows ?? [] }
    } catch {
      peerBudgetCache = { at: now, rows: [] }
    }
  }
  const p = String(peer ?? '')
  const row = peerBudgetCache.rows.find((x) => x.scope === scope && String(x.peer) === p)
  if (!row) return { scope, peer: p, tokens: 0, yuan: 0, tokenLimit: lim.tokens, yuanLimit: lim.yuan, ratio: 0, warn: false, over: false }
  const tRatio = lim.tokens > 0 ? Number(row.tokens?.total ?? 0) / lim.tokens : 0
  const yRatio = lim.yuan > 0 ? Number(row.yuan ?? 0) / lim.yuan : 0
  const ratio = Math.max(tRatio, yRatio)
  return {
    scope, peer: p,
    tokens: Number(row.tokens?.total ?? 0), yuan: Number(row.yuan ?? 0),
    tokenLimit: lim.tokens, yuanLimit: lim.yuan,
    ratio: Number(ratio.toFixed(4)),
    warn: ratio >= lim.warnRatio,
    over: ratio >= 1,
  }
}

/** 给面板/用量报表补上预算比例（不改变原字段） */
export function withBudget(cfg, report) {
  try {
    const rows = (report?.rows ?? []).map((row) => ({ ...row, budget: peerBudget(cfg, row.scope, row.peer) }))
    return { ...report, rows }
  } catch { return report }
}
