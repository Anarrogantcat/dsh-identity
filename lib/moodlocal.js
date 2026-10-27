/**
 * 本地心情引擎 v2：往「正常人」靠
 *
 * 人的心情不是一根分数条，而是：
 *   1) 有原因：一条消息先「评估」，再改情绪（夸→开心，被怼→难过，被忽视→委屈）
 *   2) 多维：开心 / 平静 / 甜 / 心疼 / 担心 / 难过 / 吃醋，各自有半衰期
 *   3) 有惯性：一句话最多把一个维度推 2 分，不会一秒翻脸
 *   4) 会恢复：不动它的时候朝 0 回落（开心 6h、吃醋 3h、心疼 24h）
 *   5) 分数由维度算出来：分数是结果，不是原因
 *
 * 全部本地、0 token。第三方心情插件看不到 QQ 消息，所以群里的心情由它负责。
 */
import { join } from 'node:path'
import { readJson, writeJson, dirs } from './store.js'

const PATH = join(dirs.root, 'moodlocal.json')
const DIMS = ['happy', 'calm', 'sweet', 'heartache', 'worry', 'sad', 'jealous', 'anger', 'pride']
const HALF_LIFE_H = { happy: 6, calm: 12, sweet: 8, heartache: 24, worry: 8, sad: 12, jealous: 3 }
const MAX_DIM = 10
const MAX_PER_EVENT = 2

const zero = () => Object.fromEntries(DIMS.map((d) => [d, 0]))

function load() {
  const j = readJson(PATH, null)
  if (!j || typeof j !== 'object') return null
  const dims = zero()
  for (const d of DIMS) dims[d] = Number(j.dims?.[d] ?? 0)
  return {
    dims, at: Number(j.at ?? Date.now()),
    hits: Number(j.hits ?? 0), events: Number(j.events ?? 0),
    lastSource: String(j.lastSource ?? ''), lastReason: String(j.lastReason ?? ''),
    lastBy: String(j.lastBy ?? ''), lastKind: String(j.lastKind ?? ''),
  }
}

function decay(dims, at, now = Date.now()) {
  const dtH = Math.max(0, now - at) / 3600000
  const out = {}
  for (const d of DIMS) {
    const hl = HALF_LIFE_H[d] ?? 12
    out[d] = Number((dims[d] * Math.pow(0.5, dtH / hl)).toFixed(3))
  }
  return out
}

/** 分数是维度的结果：开心/甜/平静往上，难过/担心/心疼/吃醋往下 */
export function scoreOf(dims) {
  const d = { ...zero(), ...(dims ?? {}) }
  const raw = 50 + 3 * d.happy + 2 * d.sweet + 1 * d.calm + 1.5 * (d.pride ?? 0) - 3 * d.sad - 2 * d.worry - 2 * d.heartache - 3 * d.jealous - 2.5 * (d.anger ?? 0)
  return Number(Math.max(0, Math.min(100, raw)).toFixed(1))
}

const ROLE_W = { owner: 1.2, admin: 1.0, member: 0.7 }

/** 评估一条消息该给她什么情绪（纯函数，方便单测） */
export function appraise(text, opts = {}) {
  const t = String(text ?? '')
  const w = ROLE_W[opts.role] ?? 0.8
  const out = {}
  const add = (dim, v) => { out[dim] = (out[dim] ?? 0) + v }
  if (/谢谢|感谢|厉害|好棒|优秀|靠谱|好耶|绝了|牛啊|牛哇/.test(t)) { add('happy', 1.5 * w); add('sweet', 0.6 * w) }
  if (/可爱|抱抱|贴贴|喜欢你|亲亲|摸摸/.test(t)) { add('sweet', 1.8 * w); add('happy', 0.6 * w) }
  if (/笨蛋|蠢|废物|垃圾|没用|烦死|讨厌|滚啊|闭嘴/.test(t)) { add('sad', 1.2 * w); add('anger', 1.6 * w); add('happy', -1.2 * w); add('jealous', 0.3 * w) }
  if (/骗|忽悠|耍我|戏弄|耍赖/.test(t)) { add('anger', 1.2 * w); add('worry', 0.4 * w) }
  if (/难过|emo|好累|累死|不开心|崩了|想哭|委屈|压力大/.test(t)) { add('heartache', 1.5 * w); add('worry', 1.0 * w) }
  if (/大肥鱼|肥鱼|鲸鱼娘|鱼鱼/.test(t)) { add('sweet', 0.8 * w) }
  if (/怎么办|来不及|着急|救命|紧急/.test(t)) { add('worry', 1.2 * w) }
  return out
}

/** 对立维度：一边涨，另一边按比例退（避免「既开心又难过」同时拉满） */
const OPPOSITE = { happy: 'sad', sad: 'happy', calm: 'worry', worry: 'calm', sweet: 'jealous', jealous: 'sweet', heartache: 'calm', anger: 'calm', pride: 'sad' }
const MAX_SUM = 16

function applyDelta(dims, delta) {
  const out = { ...dims }
  for (const [dim, v] of Object.entries(delta ?? {})) {
    if (!DIMS.includes(dim)) continue
    const capped = Math.max(-MAX_PER_EVENT, Math.min(MAX_PER_EVENT, v))
    out[dim] = Number(Math.max(0, Math.min(MAX_DIM, (out[dim] ?? 0) + capped)).toFixed(3))
    // 对立面让步：涨 1 点，对家掉 0.6 点
    // 开心/甜/得意把怒气往下压（不是对立面，但人就是这么运作的）
    if (capped > 0 && (dim === 'happy' || dim === 'sweet' || dim === 'pride') && (out.anger ?? 0) > 0) {
      out.anger = Number(Math.max(0, out.anger - capped * 0.5).toFixed(3))
    }
    const opp = OPPOSITE[dim]
    if (opp && capped > 0 && out[opp] > 0) {
      out[opp] = Number(Math.max(0, out[opp] - capped * 0.6).toFixed(3))
    }
  }
  // 总量封顶：防止七个维度各自拉满却互相矛盾
  const sum = DIMS.reduce((n, d) => n + (out[d] ?? 0), 0)
  if (sum > MAX_SUM) {
    const k = MAX_SUM / sum
    for (const d of DIMS) out[d] = Number(((out[d] ?? 0) * k).toFixed(3))
  }
  return out
}
/**
 * 记一次情绪事件：
 *   noteLocalMood('谢谢大肥鱼，好厉害', { role: 'owner' })   文本评估
 *   noteLocalMood('', { kind: 'reacted' })                    她说完有人接
 *   noteLocalMood('', { kind: 'ignored' })                    她说完没人理
 *   noteLocalMood('', { kind: 'night' })                      深夜
 */
export function noteLocalMood(text, opts = {}) {
  const now = Date.now()
  const prev = load() ?? { dims: zero(), at: now, hits: 0, events: 0 }
  let dims = decay(prev.dims, prev.at, now)
  const kind = opts.kind ?? 'text'
  const delta =
    kind === 'reacted' ? { happy: 1.5, worry: -0.8 } :
    kind === 'ignored' ? { sad: 1.2, worry: 0.6 } :
    kind === 'night' ? { calm: 0.5 } :
    appraise(text, opts)
  const before = scoreOf(dims)
  dims = applyDelta(dims, delta)
  const after = scoreOf(dims)
  const touched = Object.keys(delta).length > 0
  if (!touched) {
    // 只发生衰减也要落盘，别让旧值一直冻着
    writeJson(PATH, { dims, at: now, hits: prev.hits, events: prev.events })
    return 0
  }
  writeJson(PATH, { dims, at: now, hits: prev.hits + 1, events: prev.events + 1, lastBy: String(opts.by ?? prev.lastBy ?? '').slice(0, 20), lastKind: kind })
  return Number((after - before).toFixed(1))
}

/** 外部（模型评估）直接给七维增量：同样受「单维 ±2」惯性约束 */
export function applyDimDelta(delta, opts = {}) {
  const now = Date.now()
  const prev = load() ?? { dims: zero(), at: now, hits: 0, events: 0 }
  let dims = decay(prev.dims, prev.at, now)
  const before = scoreOf(dims)
  dims = applyDelta(dims, delta)
  writeJson(PATH, {
    dims, at: now,
    hits: prev.hits + 1,
    events: prev.events + 1,
    lastSource: opts.source ?? 'local',
    lastReason: String(opts.reason ?? '').slice(0, 60),
  })
  return { before, after: scoreOf(dims), dims }
}

export function localScore(now = Date.now()) {
  const s = load()
  if (!s) return 50
  return scoreOf(decay(s.dims, s.at, now))
}

/** 和 mood.js 的 readMood() 同一形状 */
export function readLocalMood(now = Date.now()) {
  const s = load()
  if (!s) return null
  const dims = decay(s.dims, s.at, now)
  return {
    mood: scoreOf(dims),
    dims,
    minor: false,
    name: 'local',
    updatedAt: s.at,
    stale: false,
    ageHours: Number(((now - s.at) / 3600000).toFixed(2)),
    source: 'local',
    hits: s.hits,
    events: s.events,
    lastSource: s.lastSource ?? '',
    lastReason: s.lastReason ?? '',
    lastBy: s.lastBy ?? '',
    lastKind: s.lastKind ?? '',
    at: s.at,
  }
}

export function resetLocalMood() {
  writeJson(PATH, { dims: zero(), at: Date.now(), hits: 0, events: 0 })
  return true
}
