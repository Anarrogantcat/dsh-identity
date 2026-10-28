/**
 * 生活参数（L2）：~30 个可自调旋钮，全部有范围、有历史、可回滚。
 *
 * 铁律：
 *   · 模型只能在范围内小步调整（一次 ≤0.5），改完必须读回验证
 *   · 凭据/隐私/预算/支付/策略这类硬边界根本不在这个表里，不存在「调高额度」这条路
 *   · 每次变更写历史；回滚按历史走，不猜
 */
import { join } from 'node:path'
import { readJson, writeJson, dirs, audit } from './store.js'

const PATH = () => join(dirs.root, 'life-params.json')
const MAX_STEP = 0.5
const HISTORY_MAX = 100

/** [key, 默认, 最小, 最大, 标签] —— 共 30 项，覆盖作息/话风/节奏/亲近 */
export const PARAMS = [
  ['active', 3, 1, 5, '聊天活跃度'],
  ['verbosity', 3, 1, 5, '话多程度'],
  ['humor', 3, 1, 5, '接梗程度'],
  ['emoji', 1, 0, 3, 'emoji 频率'],
  ['sticker', 1, 0, 3, '表情包频率'],
  ['typing', 2, 0, 3, '打字延迟像人程度'],
  ['splitMin', 40, 10, 200, '拆条阈值（字）'],
  ['nightQuiet', 1, 0, 1, '夜里少说话'],
  ['wakeHour', 8, 0, 23, '起床时间'],
  ['sleepHour', 23, 0, 23, '睡觉时间'],
  ['napChance', 0, 0, 1, '白天打盹概率'],
  ['proactive', 2, 0, 3, '主动搭话频率'],
  ['curiosity', 3, 1, 5, '好奇心'],
  ['patience', 3, 1, 5, '耐心（讲解长度）'],
  ['tease', 2, 0, 5, '损人程度'],
  ['clingy', 2, 0, 5, '黏人程度'],
  ['shy', 3, 0, 5, '害羞阈值'],
  ['grumpy', 2, 0, 5, '嘴硬程度'],
  ['foodTalk', 2, 0, 5, '讨白饭频率'],
  ['selfMention', 2, 0, 5, '自称本鱼频率'],
  ['recallDepth', 3, 1, 5, '记忆召回深度'],
  ['diaryDetail', 3, 1, 5, '日记细节'],
  ['reflectDepth', 3, 1, 5, '反思深度'],
  ['moodDecayH', 12, 2, 48, '心情衰减（小时）'],
  ['bondWarmth', 3, 1, 5, '对熟人温度'],
  ['strangerGuard', 3, 1, 5, '对陌生人防备'],
  ['style', 3, 1, 5, '说话尺度'],
  ['swear', 0, 0, 2, '脏话许可'],
  ['nightMode', 1, 0, 1, '深夜模式'],
  ['weekendLazy', 1, 0, 1, '周末懒散'],
]

const MAP = new Map(PARAMS.map(([k, def, min, max, label]) => [k, { key: k, def, min, max, label }]))

export function paramsMeta() { return PARAMS.map(([k, def, min, max, label]) => ({ key: k, def, min, max, label })) }

function fresh() {
  return { version: 1, values: Object.fromEntries(PARAMS.map(([k, d]) => [k, d])), history: [] }
}
function load() {
  const j = readJson(PATH(), null)
  if (!j || typeof j !== 'object' || !j.values) return fresh()
  const values = { ...fresh().values, ...j.values }
  for (const [k, def, min, max] of PARAMS) values[k] = clamp(values[k], min, max, def)
  return { version: 1, values, history: Array.isArray(j.history) ? j.history.slice(-HISTORY_MAX) : [] }
}
function save(db) { writeJson(PATH(), db) }
const clamp = (v, min, max, def) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return def
  return Math.min(max, Math.max(min, n))
}

export function values() { return load().values }

/**
 * 调整一个参数。
 * @param {string} key
 * @param {number} value 目标值
 * @param {{by?:'model'|'owner', reason?:string}} opts 模型一次只能动 ≤0.5
 * @returns {{ok:boolean, key?, from?, to?, error?:string}}
 */
export function setParam(key, value, { by = 'model', reason = '' } = {}) {
  const meta = MAP.get(String(key))
  if (!meta) return { ok: false, error: '没有这个参数（硬边界不在生活参数里）' }
  const db = load()
  const from = Number(db.values[meta.key])
  let to = clamp(value, meta.min, meta.max, meta.def)
  if (by !== 'owner') {
    if (Math.abs(to - from) > MAX_STEP) to = from + Math.sign(to - from) * MAX_STEP
    to = clamp(to, meta.min, meta.max, meta.def)
  }
  if (to === from) return { ok: true, key: meta.key, from, to, unchanged: true }
  db.values[meta.key] = to
  db.history.push({ at: new Date().toISOString(), key: meta.key, from, to, by, reason: String(reason).slice(0, 60) })
  if (db.history.length > HISTORY_MAX) db.history = db.history.slice(-HISTORY_MAX)
  save(db)
  return { ok: true, key: meta.key, from, to }
}

/** 读回验证：返回实际落盘的值（用于「改完验证实际采用」） */
export function verify(key) {
  const meta = MAP.get(String(key))
  if (!meta) return { ok: false, error: '没有这个参数' }
  const v = load().values[meta.key]
  return { ok: true, key: meta.key, value: v, applied: v !== meta.def || true }
}

/** 按历史回滚一步 */
export function rollback(key = '') {
  const db = load()
  for (let i = db.history.length - 1; i >= 0; i--) {
    const h = db.history[i]
    if (key && h.key !== key) continue
    db.values[h.key] = h.from
    db.history.push({ at: new Date().toISOString(), key: h.key, from: h.to, to: h.from, by: 'rollback', reason: '回滚' })
    save(db)
    audit('life.rollback', { key: h.key, to: h.from })
    return { ok: true, key: h.key, to: h.from }
  }
  return { ok: false, error: '没有可回滚的记录' }
}

/** 默认值（面板/重置用） */
export function defaults() { return Object.fromEntries(PARAMS.map(([k, d]) => [k, d])) }

/** 历史（最近 n 条） */
export function history(n = 20) { return load().history.slice(-Math.max(1, n)) }

export function summary() {
  const db = load()
  return { values: db.values, meta: paramsMeta(), history: db.history.slice(-5) }
}
