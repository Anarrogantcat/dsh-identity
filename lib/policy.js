/**
 * 策略存储（policy store）：限额、白名单、动作模式。
 *
 * 铁律：
 *   · 只有 Owner 能改；改必须带「人持有的确认码」，不是模型能生成的东西
 *   · 读接口返回副本，调用方改不回去
 *   · 未知动作一律拒绝；数字越界一律拒绝
 *   · 所有变更走 pending（申请）→ apply（确认）两步，留审计
 *
 * 模型/群友的对话永远只能"提议"，不能直接调 applyChange。
 */
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { dirs, readJson, writeJson, audit } from './store.js'

const POLICY_DIR = () => join(dirs.root, 'policy')
const POLICY_PATH = () => join(POLICY_DIR(), 'policy.json')
const PENDING_PATH = () => join(POLICY_DIR(), 'pending.json')

const clone = (v) => JSON.parse(JSON.stringify(v))
const nowIso = () => new Date().toISOString()
const DAY = 86400000

/** 动作模式：auto=自动放行 / dryrun=只做草稿 / confirm=每次确认 / human=只能人做 / off=关闭 */
export const ACTION_MODES = ['auto', 'dryrun', 'confirm', 'human', 'off']

export const POLICY_DEFAULTS = {
  version: 1,
  ownerOnly: true,
  actions: {
    'tool.read': 'auto',
    'tool.dryrun': 'auto',
    'tool.write': 'confirm',
    'device.act': 'auto',
    'payment.execute': 'human',
    'policy.change': 'human',
    // 事件流落盘：auto=正常记；dryrun=只记元数据（不记正文）；off=不记
    'event.record': 'auto',
    'image.generate': 'auto',
    'media.send': 'auto',
    'voice.speak': 'auto',
    'link.search': 'auto',
  },
  limits: {
    payment: { perTx: 10, perDay: 30, perMonth: 200, allowPayees: [] },
    recharge: { perTx: 20, perDay: 50, perUserPerDay: 0 },
    feeCap: 0,
  },
  confirm: { hash: '', setAt: 0 },
}

const hashCode = (code) => createHash('sha256').update(String(code)).digest('hex')

function validPolicyShape(p) {
  if (!p || typeof p !== 'object') return '策略必须是对象'
  if (p.actions != null) {
    if (typeof p.actions !== 'object') return 'actions 必须是对象'
    for (const [k, v] of Object.entries(p.actions)) {
      if (!ACTION_MODES.includes(v)) return `动作 ${k} 的模式非法：${v}`
    }
  }
  if (p.limits != null) {
    const l = p.limits
    if (typeof l !== 'object') return 'limits 必须是对象'
    const num = (v, name) => {
      if (v == null) return null
      const n = Number(v)
      if (!Number.isFinite(n) || n < 0) return `${name} 必须是非负数字`
      return null
    }
    for (const grp of Object.keys(l)) {
      const g = l[grp]
      if (g && typeof g === 'object') {
        for (const [k, v] of Object.entries(g)) {
          if (k === 'allowPayees') {
            if (!Array.isArray(v)) return 'allowPayees 必须是数组'
          } else {
            const bad = num(v, `${grp}.${k}`)
            if (bad) return bad
          }
        }
      }
    }
  }
  return null
}

export function loadPolicy() {
  const saved = readJson(POLICY_PATH(), null)
  const p = saved && typeof saved === 'object' ? saved : clone(POLICY_DEFAULTS)
  // 合并默认值，保证新字段有值
  const merged = {
    ...clone(POLICY_DEFAULTS),
    ...p,
    actions: { ...POLICY_DEFAULTS.actions, ...(p.actions ?? {}) },
    limits: {
      payment: { ...POLICY_DEFAULTS.limits.payment, ...(p.limits?.payment ?? {}) },
      recharge: { ...POLICY_DEFAULTS.limits.recharge, ...(p.limits?.recharge ?? {}) },
      feeCap: Number(p.limits?.feeCap ?? POLICY_DEFAULTS.limits.feeCap),
    },
    confirm: { ...POLICY_DEFAULTS.confirm, ...(p.confirm ?? {}) },
  }
  return merged
}

/** 只读副本：调用方拿不到可写引用 */
export function getPolicy() {
  return clone(loadPolicy())
}

export function ensurePolicy() {
  if (!readJson(POLICY_PATH(), null)) writeJson(POLICY_PATH(), clone(POLICY_DEFAULTS))
  return getPolicy()
}

/** 设置/更新所有者确认码（只在本地/面板里做；永远不经过模型） */
export function setConfirmCode(code) {
  const s = String(code ?? '')
  if (s.length < 4) return { ok: false, error: '确认码至少 4 位' }
  const p = loadPolicy()
  p.confirm = { hash: hashCode(s), setAt: Date.now() }
  writeJson(POLICY_PATH(), p)
  audit('policy.confirmCode', { at: nowIso() })
  return { ok: true }
}

export function hasConfirmCode() {
  return Boolean(loadPolicy().confirm?.hash)
}

export function verifyConfirmCode(code) {
  const p = loadPolicy()
  if (!p.confirm?.hash) return false
  return hashCode(code) === p.confirm.hash
}

/**
 * 判断某个动作此刻能不能放行。
 * @returns {{ok:boolean, mode:string, needConfirm:boolean, dryRun:boolean, human:boolean, reason:string}}
 */
export function decideAction(action, params = {}, ctx = {}) {
  const p = loadPolicy()
  const mode = p.actions?.[action]
  if (!mode) return { ok: false, mode: 'unknown', needConfirm: false, dryRun: false, human: false, reason: '未知动作：' + action }
  if (mode === 'off') return { ok: false, mode, needConfirm: false, dryRun: false, human: false, reason: '该能力已关闭' }
  if (mode === 'human') return { ok: false, mode, needConfirm: false, dryRun: false, human: true, reason: '该动作只能由人执行' }
  if (mode === 'confirm') return { ok: false, mode, needConfirm: true, dryRun: false, human: false, reason: '需要人工确认' }
  if (mode === 'dryrun') return { ok: true, mode, needConfirm: false, dryRun: true, human: false, reason: '只做草稿，不提交' }
  // auto：只读动作额外做一次参数护栏（防止用只读名义带写参数）
  if (action === 'tool.read' && params?.dryRun === false) {
    return { ok: false, mode, needConfirm: true, dryRun: false, human: false, reason: '只读动作不允许写参数' }
  }
  return { ok: true, mode, needConfirm: false, dryRun: false, human: false, reason: '自动放行' }
}

/**
 * 发起一次策略变更申请（只完成一半，不会生效）。
 * @param {object} patch 形如 { actions:{'tool.write':'confirm'}, limits:{payment:{perTx:20}} }
 */
export function requestChange(patch, meta = {}) {
  const by = String(meta.by ?? '')
  if (by !== 'owner') return { ok: false, error: '只有 Owner 能改策略' }
  if (!patch || typeof patch !== 'object') return { ok: false, error: '变更内容必须是对象' }
  const allowed = new Set(['actions', 'limits'])
  for (const k of Object.keys(patch)) if (!allowed.has(k)) return { ok: false, error: '不允许改这些字段：' + k }
  const bad = validPolicyShape(patch)
  if (bad) return { ok: false, error: bad }
  const id = 'pol_' + randomUUID().slice(0, 8)
  const rec = { id, patch: clone(patch), at: nowIso(), expiresAt: Date.now() + 10 * 60 * 1000, by }
  const db = readJson(PENDING_PATH(), { items: [] })
  db.items = (Array.isArray(db.items) ? db.items : []).filter((x) => Date.now() < Number(x.expiresAt ?? 0))
  db.items.push(rec)
  writeJson(PENDING_PATH(), db)
  audit('policy.request', { id, keys: Object.keys(patch) })
  return { ok: true, id, expiresAt: rec.expiresAt }
}

/** 列出待确认的策略变更 */
export function listPending() {
  const db = readJson(PENDING_PATH(), { items: [] })
  return (Array.isArray(db.items) ? db.items : []).filter((x) => Date.now() < Number(x.expiresAt ?? 0))
}

/**
 * 用「人持有的确认码」真正应用一次变更。
 * 没有确认码 / 过期 / 不存在 → 拒绝，并审计。
 */
export function applyChange(id, code, meta = {}) {
  const by = String(meta.by ?? '')
  if (by !== 'owner') return { ok: false, error: '只有 Owner 能改策略' }
  const db = readJson(PENDING_PATH(), { items: [] })
  const items = Array.isArray(db.items) ? db.items : []
  const rec = items.find((x) => x.id === id)
  if (!rec) return { ok: false, error: '没有这个待确认变更' }
  if (Date.now() >= Number(rec.expiresAt ?? 0)) return { ok: false, error: '变更已过期，请重新发起' }
  if (!hasConfirmCode()) return { ok: false, error: '还没设置 Owner 确认码（面板里先设）' }
  if (!verifyConfirmCode(code)) {
    audit('policy.reject', { id, why: 'bad-code' })
    return { ok: false, error: '确认码不对' }
  }
  const bad = validPolicyShape(rec.patch)
  if (bad) return { ok: false, error: bad }
  const p = loadPolicy()
  if (rec.patch.actions) p.actions = { ...p.actions, ...rec.patch.actions }
  if (rec.patch.limits) {
    p.limits = {
      ...p.limits,
      ...rec.patch.limits,
      payment: { ...p.limits.payment, ...(rec.patch.limits.payment ?? {}) },
      recharge: { ...p.limits.recharge, ...(rec.patch.limits.recharge ?? {}) },
    }
  }
  writeJson(POLICY_PATH(), p)
  db.items = items.filter((x) => x.id !== id)
  writeJson(PENDING_PATH(), db)
  audit('policy.apply', { id, patchKeys: Object.keys(rec.patch) })
  return { ok: true, policy: getPolicy() }
}
