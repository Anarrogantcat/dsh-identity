/**
 * 「饭」= 她今天还能吃的量（余额的拟人化说法）
 *
 *   · 一碗饭 ≈ usage.mealPrice 元（默认 0.01，也就是一万 token 量级的比喻）
 *   · 今日预算 = 每日预算 + 今天别人充的饭钱（跨天自动清零）
 *   · 余额 = 预算 − 今天已花（用量模块的估算值）
 *
 * 充值：群里谁都能给「充饭钱」，有单次 / 每人 / 单日三道上限，全部记审计 + 流水。
 * 流水只留当天的最近 100 笔：跨天清零，不占地方。
 */
import { readJson, writeJson, dirs, audit } from './store.js'
import { join } from 'node:path'
import { statSync, readdirSync } from 'node:fs'
import { usageReport } from './usage.js'

const PATH = join(dirs.root, 'meal.json')
const LEDGER_MAX = 100
const today = () => new Date().toISOString().slice(0, 10)

export function loadMeal() {
  const j = readJson(PATH, null)
  if (!j || typeof j !== 'object' || j.date !== today()) return { date: today(), recharge: 0, by: {}, entries: [] }
  j.recharge = Number(j.recharge ?? 0)
  j.by ??= {}
  if (!Array.isArray(j.entries)) j.entries = []
  return j
}

function mealPrice(cfg) {
  const v = Number(cfg?.usage?.mealPrice ?? 0.01)
  return Number.isFinite(v) && v > 0 ? v : 0.01
}

/** 今日饭况 */
export function balance(cfg) {
  const m = loadMeal()
  const price = mealPrice(cfg)
  const base = Math.max(0, Number(cfg?.usage?.groupDailyYuan ?? 0))
  const cap = Math.max(0, Number(cfg?.usage?.rechargeDailyCap ?? 50))
  const recharge = Math.min(cap, Number(m.recharge ?? 0))
  const budget = base + recharge
  let spent = 0
  try { spent = Number(usageReport(cfg)?.totals?.yuan ?? 0) } catch { spent = 0 }
  const remain = Math.max(0, budget - spent)
  return {
    price, spent: Number(spent.toFixed(4)), base, recharge, budget: Number(budget.toFixed(4)),
    remain: Number(remain.toFixed(4)),
    bowls: Math.floor(remain / price),
    spendBowls: Math.floor(spent / price),
    empty: remain <= 0,
    by: m.by,
    entries: m.entries.slice(-10),
    capLeft: Number(Math.max(0, cap - m.recharge).toFixed(4)),
  }
}

/** 一碗饭的说法 */
export function mealText(cfg) {
  const b = balance(cfg)
  if (b.empty) return '饭没了…今天已经吃掉 ¥' + b.spent.toFixed(2) + '（预算 ¥' + b.budget.toFixed(2) + '）。想让我继续说话，得有人给我添饭。'
  const kind = b.remain / Math.max(0.0001, b.budget) < 0.2 ? '快见底了' : b.remain / Math.max(0.0001, b.budget) < 0.6 ? '还够吃' : '预算充足'
  return '今天还剩 ' + b.bowls + ' 碗饭（约 ¥' + b.remain.toFixed(2) + ' / 今日软预算 ¥' + b.budget.toFixed(2) + '，' + kind + '）。这是今日软预算，不是平台账户余额。'
}

/**
 * 充值：yuan 元；返回 {ok, message}
 * 三道闸：单次上限 → 每人每日上限（0=不限）→ 当日总额上限
 * 另外：同一个人 60 秒内报同一笔金额，按「手滑重发」挡住。
 */
export function recharge(cfg, uid, yuan, who = '') {
  const amount = Number(yuan)
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, message: '金额不对' }
  const once = Math.max(0, Number(cfg?.usage?.rechargeMaxOnce ?? 20))
  if (amount > once) return { ok: false, message: '一次最多 ¥' + once }
  const cap = Math.max(0, Number(cfg?.usage?.rechargeDailyCap ?? 50))
  const m = loadMeal()
  if (m.recharge + amount > cap) return { ok: false, message: '今天一共最多 ¥' + cap + '，只剩 ¥' + Math.max(0, cap - m.recharge).toFixed(2) + ' 的额度' }

  const k = String(uid || 'anon')
  const now = Date.now()
  const dup = m.entries.find((e) => e && e.uid === k && Math.abs(Number(e.amount) - amount) < 1e-9 && now - Number(e.t) < 60000)
  if (dup) return { ok: false, message: '刚才已经记过一笔 ¥' + amount.toFixed(2) + ' 了，别重复发（真要再充，等一分钟或换个说法）' }

  const perUser = Math.max(0, Number(cfg?.usage?.rechargeUserDailyCap ?? 0))
  const mine = Number(m.by[k] ?? 0)
  if (perUser > 0 && mine + amount > perUser) {
    return { ok: false, message: '每人今天最多充 ¥' + perUser + '，你已充 ¥' + mine.toFixed(2) + '，还能再充 ¥' + Math.max(0, perUser - mine).toFixed(2) }
  }

  m.recharge = Number((m.recharge + amount).toFixed(4))
  m.by[k] = Number((mine + amount).toFixed(4))
  m.entries.push({ t: now, uid: k, who: String(who || '').slice(0, 24), amount: Number(amount.toFixed(4)) })
  if (m.entries.length > LEDGER_MAX) m.entries = m.entries.slice(-LEDGER_MAX)
  writeJson(PATH, m)
  try { audit('meal.recharge', { uid: k.slice(0, 12), who: String(who).slice(0, 12), amount, total: m.recharge }) } catch { /* ignore */ }
  const b = balance(cfg)
  const tail = '今天合计已充 ¥' + m.recharge.toFixed(2) + ' / 上限 ¥' + cap.toFixed(2) + '。'
  return {
    ok: true,
    message: '收到 ¥' + amount.toFixed(2) + ' 的饭钱，现在还有 ' + b.bowls + ' 碗（约 ¥' + b.remain.toFixed(2) + '）。' + tail,
    balance: b,
  }
}

/** 今天的充值流水（倒序，最多 n 笔） */
export function mealLedger(n = 5) {
  const m = loadMeal()
  return m.entries.slice(-Math.max(1, n)).reverse()
}

/** 「谁添过饭」：今天总额 + 每人 + 最近几笔（0 token） */
export function mealSummary(cfg) {
  const b = balance(cfg)
  const people = Object.entries(b.by ?? {}).filter(([, v]) => Number(v) > 0).sort((a, c) => Number(c[1]) - Number(a[1]))
  if (!people.length) return '今天还没人给我添饭（预算 ¥' + b.budget.toFixed(2) + '，还剩 ' + b.bowls + ' 碗）。'
  const head = '今天收了 ¥' + b.recharge.toFixed(2) + ' 的饭钱（' + people.length + ' 个人，上限 ¥' + Number(cfg?.usage?.rechargeDailyCap ?? 50).toFixed(2) + '）：'
  const rows = people.slice(0, 5).map(([k, v], i) => (i + 1) + '. ' + k.slice(0, 10) + ' ¥' + Number(v).toFixed(2)).join('；')
  const last = mealLedger(3).map((e) => (e.who || e.uid.slice(0, 8)) + ' ¥' + Number(e.amount).toFixed(2)).join('、')
  return head + rows + (last ? '。最近：' + last : '') + '。'
}

/** 收款码：开关关着 / 没配路径 都不发 */
export function payQrOf(cfg) {
  if (cfg?.usage?.payQrEnabled !== true) return { ok: false, reason: 'off' }
  const p = String(cfg?.usage?.payQrPath ?? '').trim()
  // 没配固定路径时，从「收款码文件夹」里挑最新的一张（适合每次都重新截的订单码）
  if (!p) {
    const dir = String(cfg?.usage?.payQrDir ?? '').trim()
    if (!dir) return { ok: false, reason: 'nopath' }
    try {
      const files = readdirSync(dir)
        .filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f))
        .map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }))
        .sort((a, b) => b.t - a.t)
      if (!files.length) return { ok: false, reason: 'nofile' }
      return { ok: true, path: join(dir, files[0].f), fromDir: true, ageMs: Date.now() - files[0].t }
    } catch { return { ok: false, reason: 'nofile' } }
  }
  try { const st = statSync(p); if (!st.isFile() || st.size <= 0) return { ok: false, reason: 'nofile' } } catch { return { ok: false, reason: 'nofile' } }
  return { ok: true, path: p }
}
