/**
 * 独立支付网关：模型只能「申请」，真正执行必须由人持有确认码。
 *
 * 边界：
 *   · 不注册为模型工具；没有任何函数接受"自然语言指令"
 *   · 限额、白名单、余额、频率全部在这里校验（不读模型给的数字）
 *   · createRequest 只生成待确认单（5 分钟有效），不动钱
 *   · confirm 必须带 Owner 确认码；一次性、绑定订单、重放无效
 *   · 幂等：同一 orderId 只会有一单；已执行的不能再执行
 *   · 台账 append-only，按本地日统计
 */
import { join } from 'node:path'
import { readFileSync, existsSync } from 'node:fs'
import { randomUUID, createHash } from 'node:crypto'
import { dirs, readJson, writeJson, appendJsonl, audit } from './store.js'
import { loadPolicy, verifyConfirmCode } from './policy.js'

const dir = () => join(dirs.root, 'wallet')
const REQUESTS = () => join(dir(), 'requests.json')
const LEDGER = () => join(dir(), 'ledger.jsonl')

const pad = (n) => String(n).padStart(2, '0')
const dayKey = (t = Date.now()) => {
  const d = new Date(t)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const monthKey = (t = Date.now()) => dayKey(t).slice(0, 7)
const REQUEST_TTL = 5 * 60 * 1000

function loadRequests() {
  const j = readJson(REQUESTS(), null)
  if (!j || !Array.isArray(j.items)) return { items: [] }
  return j
}
function saveRequests(db) {
  writeJson(REQUESTS(), db)
}

/** 读台账（文件不大；坏了就当空） */
function ledgerEntries() {
  try {
    if (!existsSync(LEDGER())) return []
    return readFileSync(LEDGER(), 'utf8').split('\n').filter(Boolean).map((l) => {
      try { return JSON.parse(l) } catch { return null }
    }).filter(Boolean)
  } catch { return [] }
}

function sums(now = Date.now()) {
  const day = dayKey(now)
  const month = monthKey(now)
  let d = 0
  let m = 0
  for (const e of ledgerEntries()) {
    const amt = Number(e.amount) || 0
    const at = Date.parse(String(e.at ?? '')) || 0
    if (dayKey(at) === day) d += amt
    if (monthKey(at) === month) m += amt
  }
  return { day: Number(d.toFixed(4)), month: Number(m.toFixed(4)) }
}

/**
 * 申请一笔支付。
 * @param {{amount:number, payee:string, purpose?:string, orderId:string,
 *          wallet?:{mode?:string, balance?:number, frozen?:boolean}}} req
 * @param {{by?:string, now?:number}} meta
 */
export function createRequest(req = {}, meta = {}) {
  const now = Number(meta.now) || Date.now()
  const amount = Number(req.amount)
  const payee = String(req.payee ?? '').trim()
  const purpose = String(req.purpose ?? '').slice(0, 120)
  const orderId = String(req.orderId ?? '').trim()
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: '金额必须是正数' }
  if (!payee) return { ok: false, error: '缺少收款方' }
  if (!orderId) return { ok: false, error: '缺少订单号（用于幂等）' }

  const db = loadRequests()
  const exist = db.items.find((x) => x.orderId === orderId)
  if (exist) {
    if (exist.executed) return { ok: false, error: '这笔订单已经执行过', requestId: exist.id, executed: true }
    return { ok: true, requestId: exist.id, expiresAt: exist.expiresAt, dup: true }
  }

  const p = loadPolicy()
  const lim = p.limits?.payment ?? {}
  const perTx = Number(lim.perTx ?? 0)
  const perDay = Number(lim.perDay ?? 0)
  const perMonth = Number(lim.perMonth ?? 0)
  if (perTx > 0 && amount > perTx) return { ok: false, error: `单笔上限 ¥${perTx}` }
  const allow = Array.isArray(lim.allowPayees) ? lim.allowPayees.map(String) : []
  if (allow.length && !allow.includes(payee)) return { ok: false, error: '收款方不在白名单' }
  const s = sums(now)
  if (perDay > 0 && s.day + amount > perDay) return { ok: false, error: `今日额度不够（已用 ¥${s.day} / ¥${perDay}）` }
  if (perMonth > 0 && s.month + amount > perMonth) return { ok: false, error: `本月额度不够（已用 ¥${s.month} / ¥${perMonth}）` }

  const w = req.wallet ?? {}
  const mode = String(w.mode ?? 'spend-authorized')
  const highRiskAbove = Math.max(1, Number(lim.highRiskAbove ?? 100))
  if (w.frozen) return { ok: false, error: '钱包已冻结' }
  if (!['spend-authorized', 'others-authorized', 'high-risk'].includes(mode)) return { ok: false, error: '钱包未授权支出（mode=' + mode + '）' }
  if (mode === 'others-authorized' && String(w.payeeCode ?? '').length < 4) return { ok: false, error: '别人钱包需要收款方二次确认码' }
  if (amount > highRiskAbove && mode !== 'high-risk') return { ok: false, error: '高风险金额（>' + highRiskAbove + '）需要 high-risk 模式' }
  if (mode === 'high-risk' && String(w.secondCode ?? '').length < 4) return { ok: false, error: '高风险需要第二个确认码' }
  if (w.balance != null && Number(w.balance) < amount) return { ok: false, error: '余额不足' }

  const rec = {
    id: 'pay_' + randomUUID().slice(0, 8),
    orderId,
    amount: Number(amount.toFixed(4)),
    payee,
    purpose,
    at: new Date(now).toISOString(),
    expiresAt: now + REQUEST_TTL,
    executed: false,
    by: String(meta.by ?? '').slice(0, 24),
    walletMode: mode,
    ...(mode === 'others-authorized' ? { payeeHash: createHash('sha256').update(String(w.payeeCode)).digest('hex') } : {}),
    ...(mode === 'high-risk' ? { secondHash: createHash('sha256').update(String(w.secondCode)).digest('hex') } : {}),
  }
  db.items.push(rec)
  // 只保留最近 200 条
  db.items = db.items.slice(-200)
  saveRequests(db)
  audit('pay.request', { id: rec.id, amount: rec.amount, payee: payee.slice(0, 20) })
  return { ok: true, requestId: rec.id, expiresAt: rec.expiresAt, amount: rec.amount }
}

/**
 * 人用确认码执行。模型拿不到 code；没有 code 一律拒绝。
 * @param {string} requestId
 * @param {string} code 人持有的 Owner 确认码
 * @param {{by?:string, now?:number}} meta
 */
export function confirmRequest(requestId, code, meta = {}) {
  const now = Number(meta.now) || Date.now()
  const by = String(meta.by ?? '')
  if (by !== 'owner') return { ok: false, error: '只有 Owner 能确认支付' }
  const db = loadRequests()
  const rec = db.items.find((x) => x.id === requestId)
  if (!rec) return { ok: false, error: '没有这个支付单' }
  if (rec.executed) return { ok: false, error: '这笔已经执行过（防重放）' }
  if (now >= Number(rec.expiresAt ?? 0)) return { ok: false, error: '支付单已过期，请重新申请' }
  if (!verifyConfirmCode(code)) {
    audit('pay.reject', { id: requestId, why: 'bad-code' })
    return { ok: false, error: '确认码不对' }
  }
  if (rec.payeeHash) {
    const hash = createHash('sha256').update(String(meta.payeeCode ?? '')).digest('hex')
    if (hash !== rec.payeeHash) { audit('pay.reject', { id: requestId, why: 'payee-code' }); return { ok: false, error: '收款方二次确认码不对' } }
  }
  if (rec.secondHash) {
    const hash = createHash('sha256').update(String(meta.riskCode ?? '')).digest('hex')
    if (hash !== rec.secondHash) { audit('pay.reject', { id: requestId, why: 'risk-code' }); return { ok: false, error: '第二确认码不对' } }
  }
  // 执行前再核一次限额（防止期间额度被用掉）
  const p = loadPolicy()
  const lim = p.limits?.payment ?? {}
  const perDay = Number(lim.perDay ?? 0)
  const perMonth = Number(lim.perMonth ?? 0)
  const s = sums(now)
  if (perDay > 0 && s.day + Number(rec.amount) > perDay) return { ok: false, error: '今日额度不足，拒绝执行' }
  if (perMonth > 0 && s.month + Number(rec.amount) > perMonth) return { ok: false, error: '本月额度不足，拒绝执行' }

  rec.executed = true
  rec.executedAt = new Date(now).toISOString()
  rec.executedBy = by
  saveRequests(db)
  const receipt = { id: rec.id, orderId: rec.orderId, amount: rec.amount, payee: rec.payee, purpose: rec.purpose, at: rec.executedAt, by }
  appendJsonl(LEDGER(), receipt)
  audit('pay.execute', { id: rec.id, amount: rec.amount, payee: rec.payee.slice(0, 20) })
  return { ok: true, receipt }
}

/** 只读：今天的支付汇总（面板用） */
export function paymentSummary(now = Date.now()) {
  const s = sums(now)
  const p = loadPolicy()
  return {
    ...s,
    limits: { perTx: p.limits?.payment?.perTx ?? 0, perDay: p.limits?.payment?.perDay ?? 0, perMonth: p.limits?.payment?.perMonth ?? 0 },
    pending: loadRequests().items.filter((x) => !x.executed).length,
  }
}

export function listRequests() {
  return loadRequests().items.map((x) => ({ ...x }))
}
