/**
 * 人物卡 + 关系图：本群谁在场、谁和谁熟（0 token，本地统计）
 *
 * 存储：<store>/relations/<peerKey>.json
 *   { people: { <uid>: { uid, name, count, lastAt, kinds{}, role? } }, recent: [{ uid, at }] }
 *
 * 只记统计，不存原始聊天；recent 只留最近 200 条「谁在几点说过话」，用于粗粒度共现。
 */
import { join } from 'node:path'
import { readdirSync } from 'node:fs'
import { readJson, writeJson, dirs, sha } from './store.js'

const DAY = 86400000
const RECENT_CAP = 200

function relDir() {
  return join(dirs.root, 'relations')
}

function pathOf(peerKey) {
  return join(relDir(), `${String(peerKey)}.json`)
}

function empty() {
  return { people: {}, recent: [], updatedAt: 0 }
}

function load(peerKey) {
  const j = readJson(pathOf(peerKey), null)
  if (!j || typeof j !== 'object' || Array.isArray(j)) return empty()
  const people = (j.people && typeof j.people === 'object' && !Array.isArray(j.people)) ? j.people : {}
  const recent = Array.isArray(j.recent)
    ? j.recent.filter((r) => r && r.uid !== undefined && r.uid !== null).slice(-RECENT_CAP)
    : []
  return { people, recent, updatedAt: Number(j.updatedAt) || 0 }
}

function save(peerKey, db) {
  try { writeJson(pathOf(peerKey), db) } catch { /* 写失败不影响主流程 */ }
}

const clampCount = (n) => Math.max(0, Math.floor(Number(n) || 0))

/** 记录一次互动（每收到一条可识别的消息调一次） */
export function recordInteraction(peerKey, uid, opts = {}) {
  if (!peerKey || uid === undefined || uid === null || String(uid).trim() === '') return null
  const u = String(uid)
  const db = load(peerKey)
  const at = opts.at === undefined || opts.at === null ? Date.now() : (Number(opts.at) || Date.parse(String(opts.at)) || Date.now())
  const now = Number.isFinite(at) ? at : Date.now()
  const name = String(opts.name ?? '').trim().slice(0, 32)
  const kind = String(opts.kind ?? '').trim().slice(0, 24)
  const role = ['owner', 'admin', 'member'].includes(opts.role) ? opts.role : ''

  const p = db.people[u] && typeof db.people[u] === 'object' && !Array.isArray(db.people[u])
    ? db.people[u]
    : { uid: u, name: '', count: 0, lastAt: '', kinds: {} }
  p.uid = u
  p.count = clampCount(p.count) + 1
  p.lastAt = new Date(now).toISOString()
  if (name) p.name = name // 只有非空才覆盖旧名
  p.kinds = (p.kinds && typeof p.kinds === 'object' && !Array.isArray(p.kinds)) ? p.kinds : {}
  if (kind) p.kinds[kind] = clampCount(p.kinds[kind]) + 1
  if (role) p.role = role
  db.people[u] = p

  db.recent.push({ uid: u, at: now })
  if (db.recent.length > RECENT_CAP) db.recent = db.recent.slice(-RECENT_CAP)
  db.updatedAt = now
  save(peerKey, db)
  return { ...p, kinds: { ...p.kinds } }
}

/** 新鲜度：7 天半衰 */
function freshnessOf(lastAt, now) {
  const t = Date.parse(lastAt ?? '') || 0
  if (!t) return 0
  return Math.pow(0.5, Math.max(0, now - t) / DAY / 7)
}

function scoreOf(p, now) {
  return clampCount(p?.count) * 0.7 + freshnessOf(p?.lastAt, now) * 0.3
}

/** 按「互动次数 0.7 + 时间新鲜度 0.3」排序取前 N（n<=0 表示全部） */
export function relationsOf(peerKey, n = 6) {
  const db = load(peerKey)
  const now = Date.now()
  const rows = Object.entries(db.people)
    .filter(([, p]) => p && typeof p === 'object')
    .map(([uid, p]) => {
      const t = Date.parse(p.lastAt ?? '') || 0
      return {
        uid,
        name: String(p.name ?? ''),
        count: clampCount(p.count),
        lastAt: p.lastAt ?? '',
        kinds: { ...(p.kinds ?? {}) },
        ...(p.role ? { role: p.role } : {}),
        daysAgo: t ? Math.max(0, (now - t) / DAY) : null,
        score: Number(scoreOf(p, now).toFixed(4)),
      }
    })
    .sort((a, b) => b.score - a.score || b.count - a.count)
  const limit = Number(n)
  return Number.isFinite(limit) && limit > 0 ? rows.slice(0, limit) : rows
}

function profileRoleMap(peerKey) {
  // profiles/<groupHash>/index.json 与 profile.js 的 listMembers 是同一份数据；
  // 成员对象里若带了 role/isOwner/isAdmin 就用，没有就不标。
  const out = new Map()
  try {
    const dir = join(dirs.profiles, String(peerKey).replace(/^[a-z]_/, ''))
    const idx = readJson(join(dir, 'index.json'), null)
    for (const m of Object.values(idx?.members ?? {})) {
      if (!m || typeof m !== 'object') continue
      const role = m.role === 'owner' || m.isOwner ? 'owner' : (m.role === 'admin' || m.isAdmin ? 'admin' : '')
      if (!role) continue
      if (m.key) out.set(String(m.key), role)
      if (m.nick) out.set(String(m.nick), role)
      if (m.name) out.set(String(m.name), role)
    }
  } catch { /* 画像不存在或损坏 → 不标角色 */ }
  return out
}

function roleOf(p, roleMap) {
  if (p.role === 'owner' || p.role === 'admin') return p.role
  if (clampCount(p.kinds?.owner) > 0) return 'owner'
  if (clampCount(p.kinds?.admin) > 0) return 'admin'
  const hit = roleMap.get(String(p.uid)) ?? roleMap.get(sha(String(p.uid), 12))
  return hit === 'owner' || hit === 'admin' ? hit : ''
}

const roleTag = (role) => (role === 'owner' ? '（群主）' : role === 'admin' ? '（管理员）' : '')

function whenPhrase(lastAt, count, now) {
  const t = Date.parse(lastAt ?? '') || 0
  if (!t) return `说过 ${count} 句`
  const d = new Date(t)
  const n = new Date(now)
  const sameDay = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()
  if (sameDay) return `今天说过 ${count} 句`
  if (now - t < 2 * DAY) return `昨天说过 ${count} 句`
  return `${Math.max(1, Math.floor((now - t) / DAY))} 天前活跃`
}

/** 在场的人（按最近活跃排序） */
export function presenceCard(peerKey, n = 5) {
  const db = load(peerKey)
  const now = Date.now()
  const roleMap = profileRoleMap(peerKey)
  const rows = Object.values(db.people)
    .filter((p) => p && typeof p === 'object' && (Date.parse(p.lastAt ?? '') || 0) > 0)
    .sort((a, b) => (Date.parse(b.lastAt ?? '') || 0) - (Date.parse(a.lastAt ?? '') || 0))
    .slice(0, Math.max(1, Number(n) || 5))
  if (!rows.length) return ''
  const lines = rows.map((p) => {
    const uid = String(p.uid ?? '')
    const name = String(p.name ?? '').trim() || `成员${uid.slice(-4)}`
    return `· ${name}${roleTag(roleOf(p, roleMap))}：${whenPhrase(p.lastAt, clampCount(p.count), now)}`
  })
  return `# 在场的人（按最近活跃）\n${lines.join('\n')}`
}

/** 关系图：节点 = 活跃的人，边 = 同一分钟内都说过话（粗略共现） */
export function relationGraph(peerKey, n = 12) {
  const db = load(peerKey)
  const nodes = relationsOf(peerKey, n).map((r) => ({ uid: r.uid, name: r.name, count: r.count }))
  const nodeSet = new Set(nodes.map((x) => String(x.uid)))
  const minutes = new Map()
  for (const r of db.recent) {
    const at = Number(r.at) || 0
    if (!at) continue
    const k = Math.floor(at / 60000)
    if (!minutes.has(k)) minutes.set(k, new Set())
    minutes.get(k).add(String(r.uid))
  }
  const weights = new Map()
  for (const set of minutes.values()) {
    const arr = [...set].filter((u) => nodeSet.has(u)).sort()
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const key = `${arr[i]}|\u0000|${arr[j]}`
        weights.set(key, (weights.get(key) ?? 0) + 1)
      }
    }
  }
  const edges = [...weights.entries()].map(([k, weight]) => {
    const [a, b] = k.split('|\u0000|')
    return { a, b, weight }
  }).sort((x, y) => y.weight - x.weight)
  return { nodes, edges }
}

export function relationsStats() {
  const dir = relDir()
  let peers = 0
  let people = 0
  let interactions = 0
  let lastAt = 0
  try {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json')) continue
      const j = readJson(join(dir, f), null)
      if (!j || typeof j !== 'object') continue
      peers += 1
      const list = Object.values(j.people ?? {}).filter((p) => p && typeof p === 'object')
      people += list.length
      interactions += list.reduce((a, p) => a + clampCount(p.count), 0)
      lastAt = Math.max(lastAt, Number(j.updatedAt) || 0)
    }
  } catch { /* 目录不存在 = 空统计 */ }
  return { peers, people, interactions, lastAt, updatedAt: lastAt ? new Date(lastAt).toISOString() : '' }
}
