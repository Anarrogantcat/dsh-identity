/**
 * 自我 traits（L1）：有证据、会演化、可退休的「我是谁」。
 *
 * 铁律（与 lifecycle.js 同一套）：
 *   · 模型只能「提议」一条 traits（带 ref 证据）
 *   · ≥3 次独立证据、跨 ≥2 天、且不是纯情绪 → 才 durable
 *   · 纯情绪/单次事件只能是 tentative，90 天无确认自动退休
 *   · Owner 可以否决（retire），但不能把它强行写成 durable
 *   · 注入只取 durable（最多 5 条），tentative 不进口吻
 */
import { join } from 'node:path'
import { readJson, writeJson, dirs, audit } from './store.js'
import { readdirSync, existsSync, writeFileSync } from 'node:fs'
import * as lc from './lifecycle.js'

const PATH = () => join(dirs.root, 'traits.json')
const LEGACY_PATH = () => join(dirs.root, 'traits-legacy.md')

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 80)

function load() {
  const j = readJson(PATH(), null)
  if (!j || typeof j !== 'object' || Array.isArray(j)) return { version: 1, items: {} }
  if (!j.items || typeof j.items !== 'object') j.items = {}
  j.version = Number(j.version) || 1
  return j
}

function save(db) {
  writeJson(PATH(), db)
}

/** 所有 traits（可选按状态过滤），durable 优先、最近确认优先 */
export function listTraits({ status = '', limit = 100 } = {}) {
  const db = load()
  const now = Date.now()
  const items = Object.values(db.items)
    .filter((t) => t && t.text)
    .map((t) => lc.expireTentative(t, now))
    .filter((t) => !status || t.status === status)
    .sort((a, b) => {
      const w = (t) => (t.status === 'durable' ? 2 : t.status === 'tentative' ? 1 : 0)
      return w(b) - w(a) || Date.parse(b.lastConfirmed ?? 0) - Date.parse(a.lastConfirmed ?? 0)
    })
  return items.slice(0, Math.max(1, Number(limit) || 100))
}

/** 只取 durable，拼成注入用短句（≤limit 条 / ≤maxChars 字） */
export function durableLines({ limit = 5, maxChars = 240 } = {}) {
  const items = listTraits({ status: 'durable', limit })
  const lines = []
  let used = 0
  for (const t of items) {
    const line = '· ' + t.text
    if (used + line.length > maxChars) break
    lines.push(line)
    used += line.length + 1
  }
  return lines
}

/**
 * 记一次「证据」：没有就新建 tentative，有就加证据并重算状态。
 * @param {string} text 这条认知（第一人称/短句）
 * @param {{ref?:string, kind?:string, peer?:string, at?:string, note?:string}} ev
 */
const SELF_MARK = /(我|本鱼)[^。！？]{0,8}(喜欢|习惯|讨厌|不会|总是|不爱|爱|怕|擅长|受不了|可以|不能|想|要)|(喜欢|讨厌|习惯|不爱|不会|总是)[^。！？]{0,8}(我|本鱼)/
export function observe(text, ev = {}) {
  const body = clean(text)
  if (!body) return { ok: false, error: '空的 traits' }
  if ((ev.kind ?? 'self-say') === 'self-say' && body.length < 16 && !SELF_MARK.test(body)) return { ok: false, skipped: '不是自我描述' }
  const db = load()
  const now = Date.now()
  let created = false
  let hit = Object.values(db.items).find((t) => t && t.text === body && t.status !== 'retired')
  if (!hit) {
    hit = lc.makeTrait({ text: body, kind: ev.kind ?? 'self-say', scope: ev.scope ?? 'global', at: ev.at })
    db.items[hit.id] = hit
    created = true
  }
  const before = hit.status
  hit = lc.addEvidence(hit, { ref: ev.ref, kind: ev.kind ?? 'self-say', at: ev.at, note: ev.note }, now)
  hit = lc.freezeGuard(hit, now)
  db.items[hit.id] = hit
  save(db)
  if (before !== hit.status) audit('traits.status', { id: hit.id, from: before, to: hit.status, hits: hit.hits })
  return { ok: true, id: hit.id, status: hit.status, hits: hit.hits, confidence: hit.confidence, created }
}

/** Owner 否决：退休（保留证据，不删） */
export function retireTrait(id, reason = 'owner') {
  const db = load()
  const t = db.items[id]
  if (!t) return { ok: false, error: '没有这条 traits' }
  db.items[id] = lc.retire(t, reason)
  save(db)
  audit('traits.retire', { id, reason: String(reason).slice(0, 40) })
  return { ok: true }
}

/** Owner 提议晋升：规则说了算，证据不够就拒绝（不允许「一句话写死人格」） */
export function promoteTrait(id) {
  const db = load()
  const t = db.items[id]
  if (!t) return { ok: false, error: '没有这条 traits' }
  const next = lc.recompute(t, Date.now())
  db.items[id] = next
  save(db)
  if (next.status !== 'durable') {
    return { ok: false, error: `证据不够（${next.hits ?? 0} 次；要 ≥3 次且跨 ≥2 天）`, trait: next }
  }
  audit('traits.promote', { id })
  return { ok: true, trait: next }
}

/** 每条调用前顺手清理过期 tentative；返回清理条数 */
export function sweep() {
  const db = load()
  const now = Date.now()
  let n = 0
  for (const [id, t] of Object.entries(db.items)) {
    const next = lc.expireTentative(t, now)
    if (next.status !== t.status) { db.items[id] = next; n += 1 }
  }
  if (n) save(db)
  return n
}

/**
 * 存量迁移（只读）：把「自我卡」里她说过/答应过的话，变成 tentative traits。
 * 原文件不动；重复执行靠 ref 幂等。首次执行把原文备份到 traits-legacy.md。
 */
export function migrateSelfCards() {
  const dir = join(dirs.root, 'self')
  if (!existsSync(dir)) return { ok: true, migrated: 0, peers: 0, skipped: true }
  let migrated = 0
  let peers = 0
  const backup = []
  for (const f of readdirSync(dir)) {
    if (!/\.json$/i.test(f)) continue
    const j = readJson(join(dir, f), null)
    const arr = Array.isArray(j?.self) ? j.self : []
    if (!arr.length) continue
    peers += 1
    backup.push(`## ${f.replace(/\.json$/i, '')}`, ...arr.map((x) => `- [${x.kind ?? 'say'}] ${x.at ?? ''} ${x.text}`), '')
    arr.forEach((x, i) => {
      const r = observe(String(x?.text ?? ''), { ref: `self:${f}:${i}`, kind: x?.kind === 'promise' ? 'promise' : 'self-say', at: x?.at })
      if (r.ok && r.created) migrated += 1
    })
  }
  if (backup.length && !existsSync(LEGACY_PATH())) {
    try {
      writeFileSync(LEGACY_PATH(), `# 自我卡迁移备份（只读，原文件未动）\n\n生成时间：${new Date().toISOString()}\n\n${backup.join('\n')}\n`, 'utf8')
    } catch { /* ignore */ }
  }
  if (migrated) audit('traits.migrate', { migrated, peers })
  return { ok: true, migrated, peers }
}

/** 面板摘要 */
export function traitsStats() {
  try {
    const items = listTraits({ limit: 500 })
    const by = { durable: 0, tentative: 0, retired: 0 }
    for (const t of items) by[t.status] = (by[t.status] ?? 0) + 1
    return { total: items.length, ...by, lastAt: items[0]?.lastConfirmed ?? null }
  } catch { return { total: 0, durable: 0, tentative: 0, retired: 0, lastAt: null } }
}

export { PATH as traitsPath }
