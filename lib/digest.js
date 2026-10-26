/**
 * 离线巩固 + 情景记忆常态化
 *
 * 每来一条消息进环形缓冲（内存 + <store>/digest/<peerKey>.json，最多 200 条）；
 * 距上次巩固 ≥1 小时且攒够 ≥5 条新消息时，本地压一条 ≤50 字摘要（不调模型），
 * 摘要按群存最多 60 条，供「昨天群里聊过什么」使用。
 */
import { join } from 'node:path'
import { readdirSync } from 'node:fs'
import { readJson, writeJson, dirs } from './store.js'

const HOUR = 3600000
const DAY = 86400000
const ITEM_CAP = 200
const SUMMARY_CAP = 60

function digestDir() {
  return join(dirs.root, 'digest')
}
function pathOf(peerKey) {
  return join(digestDir(), `${String(peerKey)}.json`)
}

function empty() {
  return { items: [], summaries: [], pending: 0, lastConsolidateAt: 0, lastNoteAt: 0 }
}

function load(peerKey) {
  const j = readJson(pathOf(peerKey), null)
  if (!j || typeof j !== 'object' || Array.isArray(j)) return empty()
  return {
    items: Array.isArray(j.items)
      ? j.items.filter((x) => x && typeof x.text === 'string' && x.text.trim()).slice(-ITEM_CAP)
      : [],
    summaries: Array.isArray(j.summaries)
      ? j.summaries.filter((s) => s && typeof s.text === 'string').slice(-SUMMARY_CAP)
      : [],
    pending: Math.max(0, Math.floor(Number(j.pending) || 0)),
    lastConsolidateAt: Number(j.lastConsolidateAt) || 0,
    lastNoteAt: Number(j.lastNoteAt) || 0,
  }
}

function save(peerKey, db) {
  try { writeJson(pathOf(peerKey), db) } catch { /* ignore */ }
}

function toIso(v) {
  if (v === undefined || v === null || v === '') return new Date().toISOString()
  if (typeof v === 'number') return new Date(v).toISOString()
  const t = Date.parse(String(v))
  return Number.isFinite(t) ? new Date(t).toISOString() : new Date().toISOString()
}

/** 每条消息进环形缓冲（内存里也有，落盘后重启仍可用） */
export function note(peerKey, msg = {}) {
  if (!peerKey) return null
  const text = String(msg.text ?? '').replace(/\s+/g, ' ').trim()
  if (!text) return null
  const db = load(peerKey)
  const item = {
    sender: String(msg.sender ?? ''),
    name: String(msg.name ?? '').slice(0, 32),
    text: text.slice(0, 120),
    at: toIso(msg.at),
  }
  db.items.push(item)
  if (db.items.length > ITEM_CAP) db.items = db.items.slice(-ITEM_CAP)
  db.pending = Math.min(ITEM_CAP, db.pending + 1)
  db.lastNoteAt = Date.now()
  save(peerKey, db)
  return { ...item }
}

function bigrams(text) {
  const out = new Set()
  const s = String(text ?? '').toLowerCase().replace(/[^\u4e00-\u9fa5a-z0-9]+/g, ' ')
  for (const chunk of s.split(' ')) {
    for (let i = 0; i < chunk.length - 1; i++) out.add(chunk.slice(i, i + 2))
    if (/^[a-z0-9]{3,}$/.test(chunk)) out.add(chunk)
  }
  return [...out]
}

function summarize(list) {
  const freq = new Map()
  for (const it of list) for (const w of bigrams(it.text)) freq.set(w, (freq.get(w) ?? 0) + 1)
  const top = [...freq.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([w]) => w)
  const longest = list
    .map((i) => String(i.text ?? '').replace(/\s+/g, ''))
    .sort((a, b) => b.length - a.length)[0] ?? ''
  const head = top.length ? `热词 ${top.join('、')}` : '零星闲聊'
  const tail = [...longest].slice(0, 30).join('')
  const s = tail && tail !== head ? `${head}｜${tail}` : head
  return [...s].slice(0, 50).join('')
}

/** 距上次 ≥1 小时 且 ≥5 条新消息 → 压一条 ≤50 字摘要 */
export function maybeConsolidate(peerKey, now = Date.now()) {
  if (!peerKey) return { ok: false, reason: '缺少 peerKey' }
  const ts = Number(now) || Date.now()
  const db = load(peerKey)
  const since = db.lastConsolidateAt ? ts - db.lastConsolidateAt : Infinity
  if (db.lastConsolidateAt && since < HOUR) {
    return { ok: false, reason: '距上次巩固不足 1 小时', waitMin: Math.ceil((HOUR - Math.max(0, since)) / 60000) }
  }
  const pending = Math.min(db.pending, db.items.length)
  if (pending < 5) return { ok: false, reason: `新消息不足 5 条（${pending}）`, pending }
  const slice = db.items.slice(-pending)
  const summary = summarize(slice)
  db.summaries.push({ at: new Date(ts).toISOString(), text: summary, count: slice.length })
  if (db.summaries.length > SUMMARY_CAP) db.summaries = db.summaries.slice(-SUMMARY_CAP)
  db.pending = 0
  db.lastConsolidateAt = ts
  save(peerKey, db)
  return { ok: true, summary, count: slice.length }
}

function fmt(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 最近 N 天的摘要（默认 1 天） */
export function digestOf(peerKey, days = 1) {
  const db = load(peerKey)
  if (!db.summaries.length) return ''
  const now = Date.now()
  const span = Math.max(1, Number(days) || 1) * DAY
  const list = db.summaries.filter((s) => now - (Date.parse(s.at) || 0) <= span).slice(-12)
  if (!list.length) return ''
  return `# 群里最近在聊\n${list.map((s) => `· ${fmt(s.at)} ${s.text}`).join('\n')}`
}

export function consolidateAll(peerKeys = [], now = Date.now()) {
  const made = []
  let skipped = 0
  for (const k of peerKeys ?? []) {
    const r = maybeConsolidate(k, now)
    if (r.ok) made.push({ peerKey: k, summary: r.summary, count: r.count })
    else skipped += 1
  }
  return { ok: true, made: made.length, skipped, summaries: made }
}

export function digestStats() {
  const dir = digestDir()
  let peers = 0
  let items = 0
  let summaries = 0
  let lastAt = 0
  try {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json')) continue
      const j = readJson(join(dir, f), null)
      if (!j || typeof j !== 'object') continue
      peers += 1
      items += Array.isArray(j.items) ? j.items.length : 0
      summaries += Array.isArray(j.summaries) ? j.summaries.length : 0
      lastAt = Math.max(lastAt, Number(j.lastNoteAt) || 0, Number(j.lastConsolidateAt) || 0)
    }
  } catch { /* 目录不存在 = 空统计 */ }
  return { peers, items, summaries, lastAt, updatedAt: lastAt ? new Date(lastAt).toISOString() : '' }
}
