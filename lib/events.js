/**
 * 事件流（事实流）：append-only，按 peer 按天分段，带自增 seq。
 *
 * 设计：
 *   · 只追加，不改不删（清理=按天删整个文件）
 *   · 每条带 origin：inbound | bot | notice | timer —— 防回环的第一道依据
 *   · ref 相同的同类事件视为重复（幂等），避免重复投递刷屏
 *   · 这是日记/反思/承诺/指标的素材底座，digest 仍只做「最近在聊什么」的短窗
 */
import { readFileSync, existsSync, readdirSync, mkdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { dirs, appendJsonl } from './store.js'

export const EVENT_KINDS = new Set([
  'talk', 'member', 'notice', 'promise', 'feeling', 'draw', 'voice', 'match', 'tool', 'pay',
])
export const ORIGINS = new Set(['inbound', 'bot', 'notice', 'timer'])

export const eventsDir = () => join(dirs.root, 'events')

const pad = (n) => String(n).padStart(2, '0')
export const dateStr = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

export function eventPath(peerKey, date = dateStr()) {
  return join(eventsDir(), String(peerKey), `${date}.jsonl`)
}

function readLines(peerKey, date) {
  const p = eventPath(peerKey, date)
  if (!existsSync(p)) return []
  try {
    return readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => {
      try { return JSON.parse(l) } catch { return null }
    }).filter(Boolean)
  } catch { return [] }
}

/** 当天最后一条的 seq（没有就是 0） */
export function lastSeq(peerKey, date = dateStr()) {
  const lines = readLines(peerKey, date)
  return lines.length ? Number(lines[lines.length - 1].seq ?? 0) : 0
}

/**
 * 追加一条事件。
 * @param {string} peerKey
 * @param {{kind:string, origin:string, text?:string, who?:string, ref?:string, causeId?:string, data?:object, at?:string}} ev
 * @returns {{ok:boolean, seq?:number, dup?:boolean, error?:string}}
 */
export function appendEvent(peerKey, ev = {}) {
  if (!peerKey) return { ok: false, error: 'no peerKey' }
  const kind = String(ev.kind ?? '')
  const origin = String(ev.origin ?? '')
  if (!EVENT_KINDS.has(kind)) return { ok: false, error: 'bad kind: ' + kind }
  if (!ORIGINS.has(origin)) return { ok: false, error: 'bad origin: ' + origin }
  const date = dateStr(ev.at ? new Date(ev.at) : new Date())
  const lines = readLines(peerKey, date)
  // 幂等：同一个 ref 的同类事件只记一次
  if (ev.ref) {
    const dup = lines.find((x) => x.ref === ev.ref && x.kind === kind)
    if (dup) return { ok: true, seq: Number(dup.seq ?? 0), dup: true }
  }
  const seq = lines.length ? Number(lines[lines.length - 1].seq ?? 0) + 1 : 1
  const record = {
    seq,
    at: ev.at ? new Date(ev.at).toISOString() : new Date().toISOString(),
    kind,
    origin,
    ...(ev.who ? { who: String(ev.who).slice(0, 24) } : {}),
    ...(ev.text ? { text: String(ev.text).replace(/\s+/g, ' ').trim().slice(0, 120) } : {}),
    ...(ev.ref ? { ref: String(ev.ref).slice(0, 80) } : {}),
    ...(ev.causeId ? { causeId: String(ev.causeId).slice(0, 80) } : {}),
    ...(ev.data && typeof ev.data === 'object' ? { data: ev.data } : {}),
  }
  try {
    appendJsonl(eventPath(peerKey, date), record)
    return { ok: true, seq }
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err) }
  }
}

/** 读某天的事件（按 seq 升序） */
export function readEvents(peerKey, date = dateStr()) {
  return readLines(peerKey, date).sort((a, b) => Number(a.seq ?? 0) - Number(b.seq ?? 0))
}

/** 列出这个 peer 有事件的天（倒序） */
export function listDays(peerKey) {
  try {
    const dir = join(eventsDir(), String(peerKey))
    if (!existsSync(dir)) return []
    return readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).map((f) => f.slice(0, 10)).sort().reverse()
  } catch { return [] }
}

/** 清掉 N 天前的整天文件（保留策略：默认 30 天） */
export function pruneEvents(keepDays = 30, now = new Date()) {
  const cutoff = dateStr(new Date(now.getTime() - Math.max(1, keepDays) * 86400000))
  let removed = 0
  try {
    const base = eventsDir()
    if (!existsSync(base)) return 0
    for (const peer of readdirSync(base)) {
      const dir = join(base, peer)
      for (const f of readdirSync(dir)) {
        if (!/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)) continue
        if (f.slice(0, 10) < cutoff) { try { unlinkSync(join(dir, f)); removed += 1 } catch { /* ignore */ } }
      }
    }
  } catch { /* ignore */ }
  return removed
}

/** 确保目录存在（测试/首次用） */
export function ensureEventsDir(peerKey) {
  mkdirSync(join(eventsDir(), String(peerKey)), { recursive: true })
}
