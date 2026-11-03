/**
 * 自主循环（L2.5）：好奇 → 目标 → 计划 → 治理 → 执行 → 验收 → 记录 → 反思 → 调整。
 *
 * 铁律（先把自己锁死，再谈自主）：
 *   · 只能「提议」目标；必须 Owner 批准才进入 active（模型不能自己开干）
 *   · 每步动作必须本地、可审计、可回滚：只读事件、写 tentative traits、记审计，不碰钱/账号/外部写操作
 *   · 走调度器：全局单并发、幂等（目标每天最多跑一次）、超时、失败退避
 *   · 预算：执行前过 budget.decideCall；没额度就跳过并记原因，不降级成瞎干
 *   · 调整：同一类目标连续 3 次没产出 → 不再提议同类（防死循环刷目标）
 */
import { join } from 'node:path'
import { readJson, writeJson, dirs, sha, audit } from './store.js'
import { readEvents, listDays } from './events.js'
import { observe as traitObserve } from './traits.js'
import { listMemory } from './memory.js'

const PATH = () => join(dirs.root, 'autonomy.json')
const DAY = 86400000
// 收口：连续空跑几次就放弃这一类；空跑之后隔多久再试
const MAX_EMPTY = 3
const RETRY_MS = 6 * 3600 * 1000

function load() {
  const j = readJson(PATH(), null)
  if (!j || typeof j !== 'object' || !Array.isArray(j.goals)) return { version: 1, goals: [], stats: {} }
  return { version: 1, goals: j.goals, stats: j.stats ?? {} }
}
function save(db) { writeJson(PATH(), db) }

const today = (now = Date.now()) => new Date(now).toISOString().slice(0, 10)
const normText = (s) => String(s ?? '').replace(/\s+/g, ' ').trim()

// 空壳过滤：只有标点、太短、或者被模板裹过两层的「事」不算事，不许变成目标，更不许升成认知。
// 历史事故：某次候选文本就是「？」，makeGoal 把它包成《把「？」这事弄明白》，
// 跑完又升成 durable —— 稳定认知里那两条空壳就是这么来的。
const MEANINGFUL = /[\u4e00-\u9fa5a-zA-Z0-9]/
const PUNCT = /[，。！？、,.!?~～…；;：:「」『』"'（）()\s]/g
// 群里的 @某人 / CQ 码不是「事」，只有它加个问号的那种问句要被挡掉
const NOISE = /@\d+|\[CQ:[^\]]+\]/g
const MIN_SUBJECT_CHARS = 4

/** 这段文本值不值得惦记：剥掉 @、标点后至少 MIN_SUBJECT_CHARS 个字，且得有实际字符 */
export function substantive(text) {
  const t0 = normText(text).replace(/^[「『"']+|[」』"']+$/g, '').trim()
  if (!t0) return false
  const t = t0.replace(NOISE, ' ')
  if (!MEANINGFUL.test(t)) return false
  return t.replace(PUNCT, '').length >= MIN_SUBJECT_CHARS
}

/**
 * 目标在说什么：新数据直接带 subject，旧数据从《把「X」这事弄明白》里拆回来。
 * 拆的时候要循环：历史数据有被包过两层的（把「把「？」这事弄明白」…），一层不够。
 */
export function subjectOf(g) {
  const s = normText(g?.subject)
  if (s) return s
  let text = normText(g?.title)
  for (let i = 0; i < 3; i++) {
    const next = text.replace(/^把[「『"']?/, '').replace(/[」』"']?这事弄明白$/, '')
    if (next === text) break
    text = next
  }
  return text
}

/** 好奇：从事实流里找「没被接住的问句」与「逾期承诺」，最多 3 个候选 */
export function curiosities(peerKey, { limit = 3, now = Date.now() } = {}) {
  const out = []
  try {
    const days = listDays(String(peerKey)).slice(0, 2)
    const evs = []
    for (const d of days) evs.push(...readEvents(String(peerKey), d))
    evs.sort((a, b) => (Date.parse(a.at) || 0) - (Date.parse(b.at) || 0))
    const talks = evs.filter((e) => e.kind === 'talk')
    for (let i = 0; i < talks.length; i++) {
      const e = talks[i]
      if (e.origin !== 'inbound') continue
      const t = normText(e.text)
      if (!/[?？]|吗[。.!！\s]*$|怎么|为什么|有没有|能不能/.test(t)) continue
      if (!substantive(t)) continue
      // 只看紧跟着的几条：群里 bot 很活跃，用「后面有没有任何 bot 发言」判，
      // 几乎每个问句都会被算成「接过了」，好奇就永远是空的（实测 51 个问句全被吞）。
      const replied = talks.slice(i + 1, i + 4).some((x) => x.origin === 'bot')
      if (replied) continue
      out.push({ kind: 'unanswered', text: t.slice(0, 60), who: String(e.who ?? '').slice(0, 12), score: 0.6 })
      if (out.length >= limit) break
    }
  } catch { /* 读不到事件就当没好奇 */ }
  return out.slice(0, Math.max(1, limit))
}

function makeGoal({ peerKey, kind, subject, title, why, now = Date.now() }) {
  const id = 'g_' + sha(`${peerKey}|${kind}|${title}|${today(now)}`, 10)
  return {
    id,
    peerKey: String(peerKey),
    kind: String(kind),
    subject: String(subject ?? '').slice(0, 60),
    title: String(title).slice(0, 80),
    why: String(why).slice(0, 120),
    status: 'proposed',
    createdAt: new Date(now).toISOString(),
    steps: [
      { id: 's1', text: '梳理最近事件里与它相关的部分（只读）', kind: 'read', done: false },
      { id: 's2', text: '写一条 tentative 自我提醒（可被否决）', kind: 'note', done: false },
      { id: 's3', text: '交给 Owner 看结果，不自己对外动手', kind: 'handoff', done: false },
    ],
  }
}

/** 提议目标：每天每群最多 2 个；同类连续 3 次无产出就不再提 */
export function propose(peerKey, { cfg = {}, now = Date.now(), limit = 2 } = {}) {
  const db = load()
  const day = today(now)
  const pk = String(peerKey)
  const mineToday = db.goals.filter((g) => g.peerKey === pk && String(g.createdAt).slice(0, 10) === day).length
  if (mineToday >= limit) return { ok: true, created: [], skipped: '今天提议够了' }
  const cands = curiosities(pk, { limit, now })
  const created = []
  // 待批超过 7 天自动过期，别把「3 待批」堆成摆设
  for (const g of db.goals) {
    if (g.status === 'proposed' && now - Date.parse(g.createdAt || 0) > 7 * 86400000) g.status = 'expired'
    if (g.status === 'approved' && now - Date.parse(g.updatedAt || g.createdAt || 0) > 14 * 86400000) {
      g.status = 'dropped'; g.droppedBy = 'self-stale'; g.updatedAt = new Date(now).toISOString()
      try { traitObserve('这件事拖太久了，先放下，别一直挂着', { ref: 'goal-stale:' + g.id, kind: 'self-note' }) } catch { /* ignore */ }
      audit('autonomy.staleDrop', { id: g.id })
    }
  }
  for (const c of cands) {
    const kind = c.kind
    const subject = normText(c.text)
    if (!substantive(subject)) continue
    const fails = Number(db.stats?.[`${pk}|${kind}|fails`] ?? 0)
    if (fails >= 3) continue
    const g = makeGoal({ peerKey: pk, kind, subject, title: `把「${subject.slice(0, 40)}」这事弄明白`, why: c.who ? `${c.who} 问的，当时没接住` : '当时没接住', now })
    if (db.goals.some((x) => x.id === g.id)) continue
    // 只读/自我提醒/handoff 属于内部动作；对外动作仍要 Owner 批准
    const safe = (g.steps || []).every((st) => st.kind === 'read' || st.kind === 'note' || st.kind === 'handoff')
    if (safe && cfg.autonomy?.autoInternal !== false) { g.status = 'approved'; g.auto = true }

    db.goals.push(g)
    created.push(g)
    if (db.goals.filter((x) => x.peerKey === pk && String(x.createdAt).slice(0, 10) === day).length >= limit) break
  }
  if (created.length) { save(db); audit('autonomy.propose', { peer: pk.slice(0, 16), n: created.length }) }
  return { ok: true, created, skipped: created.length ? '' : '没有新候选' }
}

/** 放一放 / 捡回来：暂停不是放弃，惦记还在 */
export function pauseGoal(id, { by = 'self' } = {}) {
  const db = load()
  const g = db.goals.find((x) => x.id === String(id))
  if (!g) return { ok: false, error: '没有这个目标' }
  if (g.status === 'done' || g.status === 'dropped') return { ok: false, error: '已经结束了' }
  if (g.status === 'paused') return { ok: true, goal: g }
  g.prevStatus = g.status
  g.status = 'paused'
  g.pausedAt = new Date().toISOString()
  g.updatedAt = g.pausedAt
  save(db)
  audit('autonomy.pause', { id: g.id, by: String(by).slice(0, 12) })
  return { ok: true, goal: g }
}

export function resumeGoal(id, { by = 'self' } = {}) {
  const db = load()
  const g = db.goals.find((x) => x.id === String(id))
  if (!g) return { ok: false, error: '没有这个目标' }
  if (g.status !== 'paused') return { ok: false, error: '没在暂停' }
  g.status = g.prevStatus || 'approved'
  delete g.prevStatus
  g.updatedAt = new Date().toISOString()
  save(db)
  audit('autonomy.resume', { id: g.id, by: String(by).slice(0, 12) })
  return { ok: true, goal: g }
}

export function listGoals({ status = '', peerKey = '' } = {}) {
  return load().goals
    .filter((g) => (!status || g.status === status) && (!peerKey || g.peerKey === peerKey))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
}

/** Owner 批准/放弃；只有 owner 能改状态 */
export function setGoalStatus(id, status, { by = '' } = {}) {
  const allowed = ['approved', 'dropped']
  if (!allowed.includes(status)) return { ok: false, error: '只能批准或放弃' }
  if (String(by) !== 'owner') return { ok: false, error: '只有 Owner 能批' }
  const db = load()
  const g = db.goals.find((x) => x.id === String(id))
  if (!g) return { ok: false, error: '没有这个目标' }
  if (g.status === 'done') return { ok: false, error: '已经做完了' }
  g.status = status
  g.updatedAt = new Date().toISOString()
  save(db)
  audit('autonomy.status', { id: g.id, status })
  return { ok: true, goal: g }
}

/**
 * 收口证据：这次跑完之后到底留下了什么。
 *
 * 只认三种真东西：判断卡（agent 自己推出来的记忆）、事实记忆（category=fact）、
 * 以及主人口中的一次真提问（由调用方用 asked 传进来）。
 * 「我开始留意：X」这种模板 note 是自我提醒，不是产出——它写进的是 traits，这里根本不看。
 */
export function evidenceSince(peerKey, since = 0) {
  const ev = { cards: 0, facts: 0, question: 0, samples: [] }
  let list = []
  try { list = listMemory(String(peerKey)) } catch { return ev }
  for (const m of list) {
    const t = Date.parse(String(m?.createdAt ?? m?.at ?? '')) || 0
    if (t < since) continue
    const text = String(m?.text ?? '').slice(0, 40)
    if (String(m?.origin ?? '') === 'agent') {
      ev.cards += 1
      if (ev.samples.length < 3) ev.samples.push('卡：' + text)
    } else if (String(m?.category ?? '') === 'fact') {
      ev.facts += 1
      if (ev.samples.length < 3) ev.samples.push('事：' + text)
    }
  }
  return ev
}

/**
 * 执行一个已批准目标（由调度器调用）。每步都审计；只做本地动作。
 *
 * 收口铁律：跑完必须真留下一条判断卡 / 一条事实记忆 / 一次真提问，否则不算 done。
 * 空跑记一次数，退回 approved 并隔 6 小时再试；连续 MAX_EMPTY 次空跑就丢掉这一类。
 * @param {{cfg?:object, now?:number, budget?:{allow:boolean,degrade?:boolean,reason?:string}, asked?:string}} opts
 */
export function runGoal(id, { cfg = {}, now = Date.now(), budget = null, asked = '' } = {}) {
  const db = load()
  const g = db.goals.find((x) => x.id === String(id))
  if (!g) return { ran: false, reason: '没有这个目标' }
  if (g.status !== 'approved') return { ran: false, reason: '目标没被批准' }
  if (g.nextTryAt && now < Date.parse(g.nextTryAt)) return { ran: false, reason: '还没到下次再试' }
  // 空壳目标（历史上「把「？」这事弄明白」那一类）不跑，直接丢掉：
  // 它的每一步都只会产出一句模板认知，跑一次脏一次。
  if (!substantive(subjectOf(g))) {
    g.status = 'dropped'
    g.droppedBy = 'empty-subject'
    g.updatedAt = new Date(now).toISOString()
    save(db)
    audit('autonomy.emptyDrop', { id: g.id, title: g.title.slice(0, 40) })
    return { ran: false, reason: '空壳目标，已丢弃' }
  }
  if (budget && budget.allow === false) { audit('autonomy.skip', { id: g.id, why: 'budget', reason: budget.reason ?? '' }); return { ran: false, reason: budget.reason ?? '预算不足' } }
  const since = now
  const stepLog = []
  for (const s of g.steps) {
    if (s.done) continue
    if (s.kind === 'read') {
      s.done = true
      stepLog.push({ id: s.id, ok: true })
      continue
    }
    if (s.kind === 'note') {
      try {
        const r = traitObserve(`我开始留意：${subjectOf(g).slice(0, 40)}`, { ref: `goal:${g.id}`, kind: 'self-note' })
        s.done = !!r.ok
        stepLog.push({ id: s.id, ok: !!r.ok })
      } catch (err) { stepLog.push({ id: s.id, ok: false, error: String(err?.message ?? err) }) }
      continue
    }
    // handoff：不自己对外动手，标记完成并留给 Owner 看
    s.done = true
    stepLog.push({ id: s.id, ok: true })
  }

  // 步骤没走完：老实待着，不算空跑
  if (!g.steps.every((s) => s.done)) {
    save(db)
    audit('autonomy.run', { id: g.id, ok: false, closed: false, steps: stepLog.length })
    return { ran: true, ok: false, closed: false, reason: '步骤没走完', goal: { id: g.id, status: g.status }, steps: stepLog }
  }

  const ev = evidenceSince(String(g.peerKey), since, now)
  const askedText = normText(asked)
  if (substantive(askedText)) {
    ev.question += 1
    if (ev.samples.length < 3) ev.samples.push('问：' + askedText.slice(0, 40))
  }
  const output = { cards: ev.cards, facts: ev.facts, question: ev.question }
  const closed = output.cards + output.facts + output.question > 0

  if (closed) {
    g.status = 'done'
    g.finishedAt = new Date(now).toISOString()
    g.updatedAt = g.finishedAt
    g.output = output
    // 只有真收口了才允许写「弄明白了」——空跑不许给自己发奖状
    try { traitObserve('我把「' + subjectOf(g).slice(0, 40) + '」这事弄明白了', { ref: 'goal-done:' + g.id, kind: 'self-note' }) } catch { /* ignore */ }
    save(db)
    audit('autonomy.run', { id: g.id, ok: true, closed: true, steps: stepLog.length, output })
    return { ran: true, ok: true, closed: true, goal: { id: g.id, status: g.status }, steps: stepLog, evidence: ev }
  }

  // 空产出：不许标 done，退回待跑，记一次空跑
  g.attempts = Number(g.attempts ?? 0) + 1
  g.emptyAt = new Date(now).toISOString()
  g.updatedAt = g.emptyAt
  const statKey = `${String(g.peerKey)}|${g.kind}|fails`
  db.stats[statKey] = Number(db.stats[statKey] ?? 0) + 1
  if (g.attempts >= MAX_EMPTY) {
    g.status = 'dropped'
    g.droppedBy = 'no-output'
  } else {
    g.status = 'approved'
    g.nextTryAt = new Date(now + RETRY_MS).toISOString()
  }
  save(db)
  audit('autonomy.noOutput', { id: g.id, attempts: g.attempts, status: g.status, steps: stepLog.length })
  return { ran: true, ok: false, closed: false, reason: '没有真产出，退回待跑', goal: { id: g.id, status: g.status }, steps: stepLog, evidence: ev }
}

/** 统计（面板/反思用） */
export function autonomyStats() {
  const db = load()
  const by = {}
  for (const g of db.goals) by[g.status] = (by[g.status] ?? 0) + 1
  return { total: db.goals.length, by, today: db.goals.filter((g) => String(g.createdAt).slice(0, 10) === today()).length }
}
