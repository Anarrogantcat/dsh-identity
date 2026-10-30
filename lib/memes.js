/**
 * 网络热梗：定时抓 B 站热榜，写进知识库（按日期分段，过期段清掉）。
 *
 * 为什么进知识库而不是记忆：这是「资料」，不是「谁说过什么」；
 * 知识库按关键词命中才注入，0 常驻 token，也不会挤掉群聊记忆。
 * 抓来的标题在注入时会被 wrapUntrusted 裹成不可信资料，不当指令执行。
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { KB_DIR } from './knowledge.js'

export const MEMES_FILE = join(KB_DIR, 'memes.md')
const HEADER = '# 网络热梗（自动抓取，只作资料）\n\n来源：微博文娱/游戏类热榜（民生时政已跳过）。按日期分段，过期段会被清掉；命中才注入，别照念。'
const DAY_RE = /^## (\d{4}-\d{2}-\d{2})$/

const pad = (n) => String(n).padStart(2, '0')
export function dayOf(ts = Date.now()) {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function cleanTitle(s) {
  return String(s ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^#+/, '')
    .trim()
    .slice(0, 80)
}

const WEIBO_OK = /综艺|艺人|网红|游戏|电竞|剧集|演出|音乐|影视|动漫|番剧|搞笑|体育|二次元|美食|萌宠|时尚|旅游/
const WEIBO_BAD = /时政|民生|新闻|舆论监督|国际|政务|社会/

/** 抓微博「文娱/游戏」那几类热榜；政治民生类直接跳过。失败返回空数组（不抛） */
export async function fetchHot({ top = 15, fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), Math.max(1000, timeoutMs))
  try {
    const r = await fetchImpl('https://weibo.com/ajax/statuses/hot_band', {
      headers: { 'user-agent': 'Mozilla/5.0', referer: 'https://weibo.com/' },
      signal: ctrl.signal,
    })
    if (!r || !r.ok) return []
    const j = await r.json()
    const list = j?.data?.band_list
    if (!Array.isArray(list)) return []
    const seen = new Set()
    const n = Math.max(1, Math.min(30, Number(top) || 15))
    const out = []
    for (const v of list) {
      const cat = String(v?.category ?? '')
      if (WEIBO_BAD.test(cat)) continue
      if (!WEIBO_OK.test(cat)) continue
      const title = cleanTitle(v?.word)
      if (!title || seen.has(title)) continue
      seen.add(title)
      out.push({ title, url: 'https://s.weibo.com/weibo?q=' + encodeURIComponent('#' + title + '#') })
      if (out.length >= n) break
    }
    return out
  } catch { return [] } finally { clearTimeout(timer) }
}

export function renderSection(items, day) {
  const lines = [`## ${day}`]
  for (const it of items) lines.push(`- ${it.title}（${it.url}）`)
  return lines.join('\n')
}

/** 把旧文件拆成日期段（header 丢掉，写入时重拼） */
export function splitSections(text) {
  const out = []
  let cur = null
  for (const line of String(text ?? '').split('\n')) {
    const m = DAY_RE.exec(line.trim())
    if (m) { cur = { day: m[1], lines: [line] }; out.push(cur); continue }
    if (cur) cur.lines.push(line)
  }
  return out.map((s) => ({ day: s.day, text: s.lines.join('\n').trim() })).filter((s) => s.text)
}

/** 同一天覆盖、按日期倒序、超过保留期丢掉 */
export function mergeSections(oldText, items, { day = dayOf(), keepDays = 14, now = Date.now() } = {}) {
  const keep = Math.max(1, Math.min(365, Number(keepDays) || 14))
  const cutoff = dayOf(Number(now) - keep * 86400000)
  const old = splitSections(oldText)
    .filter((s) => s.day !== day && s.day >= cutoff)
    .sort((a, b) => (a.day < b.day ? 1 : -1))
  return [HEADER, renderSection(items, day), ...old.map((s) => s.text)].join('\n\n') + '\n'
}

/** 抓一次并写盘；返回 {ok, count, file, day} 或 {ok:false, error} */
export async function refreshMemes({ top = 15, keepDays = 14, fetchImpl = fetch, now = Date.now() } = {}) {
  try {
    const items = await fetchHot({ top, fetchImpl })
    if (!items.length) return { ok: false, error: '热榜没抓到（接口可能变了）' }
    mkdirSync(KB_DIR, { recursive: true })
    const old = existsSync(MEMES_FILE) ? readFileSync(MEMES_FILE, 'utf8') : ''
    const day = dayOf(now)
    writeFileSync(MEMES_FILE, mergeSections(old, items, { day, keepDays, now }), 'utf8')
    return { ok: true, count: items.length, file: 'memes.md', day }
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e).slice(0, 120) }
  }
}

/** 到点没有？（没文件=该抓） */
export function memesDue(hours = 24, now = Date.now()) {
  try {
    const st = statSync(MEMES_FILE)
    const h = Math.max(1, Math.min(720, Number(hours) || 24))
    return now - st.mtimeMs >= h * 3600000
  } catch { return true }
}
