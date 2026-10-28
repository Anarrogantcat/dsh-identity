/**
 * P12 生活参数测试：范围、模型步长、读回验证、回滚、硬边界不可调
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-p12-'))
delete process.env.QQBOT_REFINE_HOME
const url = (p) => new URL(p, import.meta.url).href
const L = await import(url('../lib/lifeparams.js'))
const { ensureStore } = await import(url('../lib/config.js'))
const { ensureDirs } = await import(url('../lib/store.js'))
ensureStore(); ensureDirs()
const ok = []
const T = (n, p, d) => ok.push([n, !!p, d])

T('参数数量 ≥30', L.paramsMeta().length >= 30, L.paramsMeta().length)
T('默认值在范围内', L.paramsMeta().every((m) => { const v = L.values()[m.key]; return v >= m.min && v <= m.max }))
T('凭据/预算/支付不可调', ['budget', 'policy', 'payment', 'credentials', 'privacy'].every((k) => L.setParam(k, 1).ok === false))

// 模型步长 ≤0.5
{
  const r = L.setParam('active', 5, { by: 'model' })
  T('模型一次最多动 0.5', r.ok && Math.abs(r.to - r.from) <= 0.5, r)
  const v = L.verify('active')
  T('读回验证一致', v.ok && v.value === r.to, v)
  T('越界夹回范围', L.setParam('active', 99, { by: 'owner' }).to === 5)
}

// 回滚
{
  const before = L.values().active
  const r = L.setParam('active', before - 0.4, { by: 'model', reason: '测试' })
  const back = L.rollback('active')
  T('能回滚', back.ok && L.values().active === before, { r, back, now: L.values().active })
}

// 历史
{
  const h = L.history(10)
  T('历史有记录', h.length >= 1 && h[0].key)
}

console.log('=== P12 生活参数测试 ===')
let fail = 0
for (const [n, p, d] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d))); if (!p) fail++ }
console.log(fail ? `失败 ${fail}` : '全部通过')
try { rmSync(process.env.DSH_HOME, { recursive: true, force: true }) } catch {}
process.exitCode = fail ? 1 : 0
