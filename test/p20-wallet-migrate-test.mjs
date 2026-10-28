/**
 * P20 钱包层级 + 数据目录迁移测试
 *  - others-authorized：别人钱包要收款方二次确认码
 *  - high-risk：超过风险线要 high-risk 模式 + 第二确认码
 *  - 默认配置优先用 dsh-identity 数据目录（迁移后）
 */
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-p20-'))
delete process.env.QQBOT_REFINE_HOME
const HOME = process.env.DSH_HOME
const url = (p) => new URL(p, import.meta.url).href
const { ensureStore } = await import(url('../lib/config.js'))
const { ensureDirs } = await import(url('../lib/store.js'))
ensureStore(); ensureDirs()
const G = await import(url('../lib/gateway.js'))
const P = await import(url('../lib/policy.js'))
P.ensurePolicy()
P.setConfirmCode('2468')

const ok = []
const T = (n, p, d) => ok.push([n, !!p, d])

// others-authorized：必须带收款方二次确认码
{
  const bad = G.createRequest({ amount: 5, payee: '小红', orderId: 'o1', wallet: { mode: 'others-authorized' } })
  T('别人钱包缺二次码被拒', bad.ok === false && /二次/.test(bad.error), bad)
  const r = G.createRequest({ amount: 5, payee: '小红', orderId: 'o2', wallet: { mode: 'others-authorized', payeeCode: '7788' } })
  T('带二次码能建单', r.ok === true, r)
  const noSecond = G.confirmRequest(r.requestId, '2468', { by: 'owner' })
  T('确认时缺二次码被拒', noSecond.ok === false && /二次/.test(noSecond.error), noSecond)
  const good = G.confirmRequest(r.requestId, '2468', { by: 'owner', payeeCode: '7788' })
  T('确认码 + 二次码才执行', good.ok === true, good)
}

// high-risk：超过风险线要 high-risk 模式
{
  const req = P.requestChange({ limits: { payment: { perTx: 500, perDay: 500 } } }, { by: 'owner' })
  P.applyChange(req.id, '2468', { by: 'owner' })
  const low = G.createRequest({ amount: 150, payee: '小明', orderId: 'o3', wallet: { mode: 'spend-authorized' } })
  T('高风险金额普通模式被拒', low.ok === false && /高风险/.test(low.error), low)
  const hr = G.createRequest({ amount: 150, payee: '小明', orderId: 'o4', wallet: { mode: 'high-risk' } })
  T('high-risk 缺第二码被拒', hr.ok === false && /第二/.test(hr.error), hr)
  const good = G.createRequest({ amount: 150, payee: '小明', orderId: 'o5', wallet: { mode: 'high-risk', secondCode: '9988' } })
  T('high-risk 带第二码能建单', good.ok === true, good)
  const noRisk = G.confirmRequest(good.requestId, '2468', { by: 'owner' })
  T('高风险确认缺第二码被拒', noRisk.ok === false && /第二/.test(noRisk.error), noRisk)
  const done = G.confirmRequest(good.requestId, '2468', { by: 'owner', riskCode: '9988' })
  T('高风险双码才执行', done.ok === true, done)
}

// 数据目录迁移优先
{
  mkdirSync(join(HOME, 'storages', 'dsh-identity'), { recursive: true })
  const fresh = await import(url('../lib/config.js') + '?mig=1')
  T('迁移后优先用 dsh-identity 目录', /dsh-identity$/.test(fresh.STORE_DIR.replace(/[\\\\/]+$/, '')), fresh.STORE_DIR)
}

console.log('=== P20 钱包层级/数据迁移测试 ===')
let fail = 0
for (const [n, p, d] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d))); if (!p) fail++ }
console.log(fail ? '失败 ' + fail : '全部通过')
try { rmSync(HOME, { recursive: true, force: true }) } catch {}
process.exit(fail ? 1 : 0)
