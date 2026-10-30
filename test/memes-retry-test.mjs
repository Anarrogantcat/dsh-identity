/**
 * 热梗抓取失败重试：失败排期 10 分钟 → 40 分钟 → 2 小时，成功清空，第 4 次不再排
 */
import { mkdtempSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-memes-retry-'))
delete process.env.QQBOT_REFINE_HOME

const url = (p) => new URL(p, import.meta.url).href
const { ensureStore } = await import(url('../lib/config.js'))
const { ensureDirs } = await import(url('../lib/store.js'))
const M = await import(url('../lib/memes.js'))
ensureStore(); ensureDirs()

const ok = []
const T = (n, p, d) => ok.push([n, !!p, d])
const MIN = 60000
const fail = async () => ({ ok: false, json: async () => ({}) })
const good = async (u) => ({ ok: true, json: async () => ({ items: u.includes('cnmeme') ? [{ title: '梗一', summary: '' }] : [] }) })

// 第一次失败：排 10 分钟后
{
  const t0 = Date.now()
  const r = await M.refreshMemes({ fetchImpl: fail, now: t0 })
  T('失败返回 ok:false', r.ok === false && r.attempts === 1, r)
  T('第一次隔 10 分钟', Math.round((Date.parse(r.retryAt) - t0) / MIN) === 10, r.retryAt)
  T('没到点不重抓', M.memesDue(24, t0 + 5 * MIN) === false)
  T('到点该重抓', M.memesDue(24, t0 + 11 * MIN) === true)
}

// 第二次失败：隔 40 分钟
{
  const t1 = Date.now()
  const r = await M.refreshMemes({ fetchImpl: fail, now: t1 })
  T('第二次隔 40 分钟', r.attempts === 2 && Math.round((Date.parse(r.retryAt) - t1) / MIN) === 40, r)
}

// 第三次失败：隔 2 小时
{
  const t2 = Date.now()
  const r = await M.refreshMemes({ fetchImpl: fail, now: t2 })
  T('第三次隔 120 分钟', r.attempts === 3 && Math.round((Date.parse(r.retryAt) - t2) / MIN) === 120, r)
}

// 第四次：不再排期，回到正常周期判断
{
  const t3 = Date.now()
  const r = await M.refreshMemes({ fetchImpl: fail, now: t3 })
  T('第四次不再排期', r.attempts === 4 && r.retryAt === '', r)
  T('排期用尽按文件时间判断', M.memesDue(24, t3) === true)
}

// 成功一次：重试状态清空
{
  const t4 = Date.now()
  const r = await M.refreshMemes({ fetchImpl: good, now: t4 })
  T('成功后 ok', r.ok === true && r.count === 1, r)
  T('成功后重试记录清空', M.retryInfo() === null, M.retryInfo())
  T('刚抓完不到点', M.memesDue(24, t4 + MIN) === false)
  const past = (t4 - 25 * 3600000) / 1000
  utimesSync(M.MEMES_FILE, past, past)
  T('文件老了才该抓', M.memesDue(24, t4) === true)
}

console.log('=== 热梗失败重试测试 ===')
let bad = 0
for (const [n, p, d] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d))); if (!p) bad++ }
console.log(bad ? '失败 ' + bad : '全部通过')
try { rmSync(process.env.DSH_HOME, { recursive: true, force: true }) } catch {}
process.exit(bad ? 1 : 0)
