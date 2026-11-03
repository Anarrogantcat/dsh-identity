/**
 * 「像正常人」的人格规则（2026-11-03 定）：
 *
 *   1. 同一场合重复不算新证据 —— 一天里把一句口头禅说三遍，不是三次证据
 *   2. 得有人当面认过 —— 没有 confirmedBy(by=user)，纯自我感觉不上位
 *   3. 承诺 / 口头禅不进人格 —— 「我明天要早睡」是打算，不是性格
 *   4. 人格是稀有的 —— durable 上限 12 条，超了最弱的先退
 *   5. 不追溯降级 —— 老的人格不因为新规矩当场塌掉，只标 stale 等复核
 */
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-normal-'))
delete process.env.QQBOT_REFINE_HOME

const url = (p) => new URL(p, import.meta.url).href
const L = await import(url('../lib/lifecycle.js'))
const T = await import(url('../lib/traits.js'))
const { ensureStore } = await import(url('../lib/config.js'))
const { ensureDirs, dirs } = await import(url('../lib/store.js'))
ensureStore()
ensureDirs()

const ok = []
const T_ = (n, p, d) => ok.push([n, !!p, d])
const DAY = 86400000
const base = Date.UTC(2026, 10, 1, 4, 0, 0)

const mk = (text = '我不爱长篇解释', kind = 'self-say') => L.makeTrait({ text, kind })
const ev = (d, kind = 'self-say', ref = '') => ({ at: new Date(base + d * DAY).toISOString(), kind, ref })

// 一、同一天同一来源说三遍，只算一次证据
{
  let t = mk()
  t = L.addEvidence(t, ev(0, 'self-say', 'a'))
  t = L.addEvidence(t, ev(0, 'self-say', 'b'))
  t = L.addEvidence(t, ev(0, 'self-say', 'c'))
  const s = L.evidenceStats(t.evidence)
  T_('三次同日不同 ref 仍算一次', s.independent === 1 && s.hits === 3, s)
  T_('因此升不了 durable', t.status === 'tentative', t.status)
}

// 二、跨三天，但没人认过 → 还是 tentative
{
  let t = mk()
  for (let d = 0; d < 3; d++) t = L.addEvidence(t, ev(d, 'self-say', 'r' + d))
  T_('跨三天独立证据=3', t.evidence && L.evidenceStats(t.evidence).independent === 3, L.evidenceStats(t.evidence))
  T_('没人认过就不升', t.status === 'tentative', t.status)
}

// 三、跨三天 + 群友亲口认过一次 → durable
{
  let t = mk()
  for (let d = 0; d < 3; d++) t = L.addEvidence(t, ev(d, 'self-say', 'r' + d))
  t = L.confirmWith(t, { ref: 'mem:1', by: 'user' }, base)
  T_('有人认过才升 durable', t.status === 'durable', t.status)
  T_('不是 stale', t.stale !== true, t.stale)
}

// 四、承诺永远不进人格
{
  let t = mk('明天早点睡', 'promise')
  for (let d = 0; d < 3; d++) t = L.addEvidence(t, ev(d, 'promise', 'p' + d))
  t = L.confirmWith(t, { ref: 'mem:p', by: 'user' }, base)
  T_('承诺不升人格', t.status === 'tentative', t.status)
}

// 五、口头禅文本也不进（哪怕 kind 不是 promise）
{
  let t = mk('摸可以，摸完记得给饭')
  for (let d = 0; d < 3; d++) t = L.addEvidence(t, ev(d, 'self-say', 'c' + d))
  t = L.confirmWith(t, { ref: 'mem:c', by: 'user' }, base)
  T_('口头禅不升人格', t.status === 'tentative', t.status)
  T_('isCatchphrase 认得出', L.isCatchphrase(t) === true)
}

// 六、纯情绪不升（老规矩保留）
{
  let t = mk('我今天有点低落')
  for (let d = 0; d < 3; d++) t = L.addEvidence(t, ev(d, 'feeling', 'f' + d))
  t = L.confirmWith(t, { ref: 'mem:f', by: 'user' }, base)
  T_('纯情绪不升', t.status === 'tentative', t.status)
}

// 七、老 durable 不追溯降级，只标 stale
{
  const old = { ...mk('我说过要安静点'), status: 'durable', confidence: 0.8, evidence: [ev(0), ev(1)] }
  const next = L.recompute(old, base + 2 * DAY)
  T_('老 durable 保持 durable', next.status === 'durable', next.status)
  T_('但标了 stale', next.stale === true, next.stale)
}

// 八、durable 上限 12：多的退成 tentative
{
  const items = {}
  for (let i = 0; i < 13; i++) {
    const id = 't' + i
    items[id] = {
      id, text: '我是第' + i + '种人', kind: 'self-say', scope: 'global',
      status: 'durable', confidence: 0.5 + i * 0.02, evidence: [ev(0), ev(1), ev(2)],
      firstSeen: new Date(base).toISOString(), lastConfirmed: new Date(base + 2 * DAY).toISOString(),
      hits: 3, conflict: false, confirmedBy: [{ at: new Date(base).toISOString(), ref: 'mem:x', by: 'user' }], refutedBy: [],
    }
  }
  writeFileSync(join(dirs.root, 'traits.json'), JSON.stringify({ version: 1, items }))
  T.sweep()
  const after = JSON.parse(readFileSync(join(dirs.root, 'traits.json'), 'utf8')).items
  const durable = Object.values(after).filter((t) => t.status === 'durable')
  T_('durable 压到 12 条', durable.length === 12, durable.length)
  T_('最弱的那条被降级', after.t0?.status === 'tentative' && after.t0?.demotedBy === 'cap', after.t0)
}

console.log('=== 人格规则（像正常人）测试 ===')
let fail = 0
for (const [n, p, d] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d))); if (!p) fail++ }
console.log(fail ? `失败 ${fail}` : '全部通过')
try { rmSync(process.env.DSH_HOME, { recursive: true, force: true }) } catch { /* ignore */ }
process.exitCode = fail ? 1 : 0
