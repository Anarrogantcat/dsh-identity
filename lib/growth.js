/**
 * 成长指标（L2，只读汇总）：稳定认知数、矛盾率、兑现率、情绪状态。
 * 只读现有数据，不新增状态；面板/周报/月报共用。
 */
import * as traits from './traits.js'
import { listPromises } from './promises.js'
import { getState, blendsOf } from './moodv2.js'
import { weekSummary, monthSummary } from './reflection.js'
import { listMemory } from './memory.js'
import * as pace from './pace.js'

export function growthMetrics(peerKey = '') {
  const ts = traits.listTraits({ limit: 500 })
  const durable = ts.filter((t) => t.status === 'durable').length
  const tentative = ts.filter((t) => t.status === 'tentative').length
  const conflicts = ts.filter((t) => t.conflict === true).length
  const confRate = ts.length ? Number((conflicts / ts.length).toFixed(3)) : 0

  const ps = listPromises(peerKey ? { peerKey } : {})
  const open = ps.filter((p) => p.status === 'open')
  const done = ps.filter((p) => p.status === 'done')
  const overdue = open.filter((p) => p.overdue)
  const settled = done.length + open.length
  const fulfillRate = settled ? Number((done.length / settled).toFixed(2)) : 0

  let mood = { blends: [], events: 0 }
  try { const s = getState(); mood = { blends: blendsOf(s).map((x) => x.label), events: s.events } } catch { /* ignore */ }

  // 判断卡：她对这个人的结论（不是原话），这才是「记事」该记的东西
  let judgments = 0
  if (peerKey) {
    try {
      judgments = listMemory(peerKey).filter((x) => x.origin === 'agent' && ['preference', 'relation', 'fact'].includes(x.category)).length
    } catch { /* ignore */ }
  }
  // 精力：强度 + 今天硬撑着回了多少次（精力驱动成长的可见证据）
  let energy = null
  try { const p = pace.snapshot(); energy = { energy: p.energy, tone: p.tone, tired: p.tired } } catch { /* ignore */ }

  return {
    traits: { total: ts.length, durable, tentative, conflicts, conflictRate: confRate },
    promises: { total: ps.length, open: open.length, done: done.length, overdue: overdue.length, fulfillRate },
    mood,
    judgments,
    energy,
    week: peerKey ? weekSummary(peerKey) : null,
    month: peerKey ? monthSummary(peerKey) : null,
  }
}
