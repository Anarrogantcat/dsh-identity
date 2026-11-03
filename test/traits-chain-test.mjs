/**
 * 认知链：一条 traits 到底被谁确认过、被谁否过。
 *
 * 以前只有 evidence（次数），没有「谁」——群友亲口说的和本鱼自己推的，
 * 在 traits.json 里长得一模一样。这里补两条线：
 *   · confirmedBy：群友（user）/ 判断卡（judge）各确认过几次
 *   · refutedBy：被改口否掉过几次；≥2 次且压过确认次数 → 降回 tentative
 *
 * 回填是复盘时做的（reflectDay → backfillFromMemory），幂等，不重复计数。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOME = mkdtempSync(join(tmpdir(), 'dsh-chain-'))
process.env.DSH_HOME = HOME
delete process.env.QQBOT_REFINE_HOME

const url = (p) => new URL(p, import.meta.url).href
const T = await import(url('../lib/traits.js'))
const M = await import(url('../lib/memory.js'))
const L = await import(url('../lib/lifecycle.js'))
const E = await import(url('../lib/events.js'))
const R = await import(url('../lib/reflection.js'))
const { ensureStore } = await import(url('../lib/config.js'))
const { ensureDirs, peerKey, dirs, readJson } = await import(url('../lib/store.js'))
ensureStore()
ensureDirs()

const ok = []
const T_ = (n, p, d) => ok.push([n, !!p, d])
const PK = peerKey('group', 'G-CHAIN')
const traitOf = (id) => readJson(join(dirs.root, 'traits.json'), { items: {} }).items[id]

// 一、新认知就带两条链（空数组）
{
  const t = L.makeTrait({ text: '我不爱长篇解释' })
  T_('新 traits 带 confirmedBy/refutedBy', Array.isArray(t.confirmedBy) && Array.isArray(t.refutedBy), t)
}

const dayAt = (d) => new Date(Date.now() - d * 86400000).toISOString()

// 二、确认按 ref 去重；但确认本身不构成人格，得有跨场合的行为证据
{
  let t = L.makeTrait({ text: '我不爱长篇解释' })
  t = L.confirmWith(t, { ref: 'a', by: 'user' }, Date.now())
  t = L.confirmWith(t, { ref: 'a', by: 'user' }, Date.now())
  T_('同一个 ref 只算一次', t.confirmedBy.length === 1 && t.hits === 1, { n: t.confirmedBy.length, hits: t.hits })
  T_('只靠确认升不了 durable', t.status === 'tentative', t.status)
  for (let d = 1; d <= 3; d++) t = L.addEvidence(t, { ref: 'e' + d, kind: 'self-say', at: dayAt(d) })
  t = L.confirmWith(t, { ref: 'b', by: 'user' }, Date.now())
  T_('跨场合 + 有人认过才升 durable', t.status === 'durable', t.status)
}

// 三、否认压过确认 → 降回 tentative；否认不加证据
{
  let t = L.makeTrait({ text: '我不爱长篇解释' })
  for (let d = 1; d <= 3; d++) t = L.addEvidence(t, { ref: 'e' + d, kind: 'self-say', at: dayAt(d) })
  t = L.confirmWith(t, { ref: 'a', by: 'user' }, Date.now())
  T_('先升到 durable', t.status === 'durable', t.status)
  const hitsBefore = t.hits
  t = L.refuteWith(t, { ref: 'x', reason: '改口' }, Date.now())
  T_('否认不追加证据', t.hits === hitsBefore, { before: hitsBefore, after: t.hits })
  T_('一次否认还压不下去', t.status === 'durable', t.status)
  t = L.refuteWith(t, { ref: 'y', reason: '改口' }, Date.now())
  T_('否认追平确认就降回 tentative', t.status === 'tentative' && t.confidence <= 0.3, { status: t.status, c: t.confidence })
}

// 四、回填：群友确认 / 判断卡旁证 / 改口否认，且幂等
{
  const w = T.observe('我不爱长篇解释', { kind: 'self-say', ref: 'self:1' })
  T_('先有一条 traits', w.ok === true, w)
  const mA = M.addMemory(PK, { text: '不爱长篇解释', category: 'preference', origin: 'user', source: 'group' })
  const mB = M.addMemory(PK, { text: '他不爱长篇解释', category: 'preference', origin: 'agent', source: 'judge' })

  const b1 = T.backfillFromMemory(PK)
  T_('回填认到两次确认', b1.ok === true && b1.confirmed === 2, b1)
  const t1 = traitOf(w.id)
  T_('群友确认记成 user', t1.confirmedBy.some((x) => x.by === 'user'), t1.confirmedBy)
  T_('判断卡记成 judge', t1.confirmedBy.some((x) => x.by === 'judge'), t1.confirmedBy)

  const b2 = T.backfillFromMemory(PK)
  T_('回填幂等', b2.confirmed === 0 && b2.refuted === 0, b2)

  // 改口：两条当初确认过的记忆都被作废。
  // 用 id 定位——关键词「不爱长篇解释」会同时命中两条，按新规矩就该被拒绝（有测试守着）。
  M.correctMemory(PK, { id: mA.id, text: '其实他能接受长篇解释', by: 'owner' })
  M.correctMemory(PK, { id: mB.id, text: '他其实能接受长篇解释', by: 'owner' })
  const b3 = T.backfillFromMemory(PK)
  const t3 = traitOf(w.id)
  T_('改口记成否认', b3.refuted === 2 && t3.refutedBy.length === 2, { b3, refuted: t3.refutedBy })
  T_('否认压过确认就降级', t3.status === 'tentative', t3.status)
}

// 五、复盘时自动回填（不用手动调 backfillFromMemory）
{
  const pk2 = peerKey('group', 'G-CHAIN-2')
  E.appendEvent(pk2, { kind: 'talk', origin: 'inbound', who: '小明', text: '今天聊到插件' })
  const w = T.observe('我不爱长篇解释', { kind: 'self-say', ref: 'self:2' })
  M.addMemory(pk2, { text: '不爱长篇解释', category: 'preference', origin: 'user', source: 'group' })
  const r = R.reflectDay(pk2, undefined, { force: true })
  const t = traitOf(w.id)
  T_('复盘跑得动', r.ok === true, r)
  T_('复盘顺手回填了确认', (t.confirmedBy ?? []).some((x) => x.by === 'user'), t.confirmedBy)
}

console.log('=== 认知链（traits 确认/否认）测试 ===')
let fail = 0
for (const [n, p, d] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d))); if (!p) fail++ }
console.log(fail ? `失败 ${fail}` : '全部通过')
try { rmSync(HOME, { recursive: true, force: true }) } catch { /* ignore */ }
process.exitCode = fail ? 1 : 0
