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
const HEADER = '# 网络热梗（自动抓取，只作资料）\n\n来源：微博文娱/游戏热榜 + B 站热门（时政民生已跳过）。按日期分段，过期段会被清掉；命中才注入，别照念。'
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
const BILI_BAD = /央视|新闻|时政|政务|政府|外交|军事|战争|疫情|通报|警方|法院|检察|政策|选举|领导人|主席|总理|大使/

async function getJson(url, { fetchImpl, timeoutMs, referer }) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), Math.max(1000, timeoutMs))
  try {
    const r = await fetchImpl(url, {
      headers: { 'user-agent': 'Mozilla/5.0', referer },
      signal: ctrl.signal,
    })
    if (!r || !r.ok) return null
    return await r.json()
  } catch { return null } finally { clearTimeout(timer) }
}

/** 微博文娱/游戏类热榜；政治民生类直接跳过 */
export async function fetchWeibo({ top = 15, fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  const j = await getJson('https://weibo.com/ajax/statuses/hot_band', { fetchImpl, timeoutMs, referer: 'https://weibo.com/' })
  const list = j?.data?.band_list
  if (!Array.isArray(list)) return []
  const seen = new Set()
  const out = []
  for (const v of list) {
    const cat = String(v?.category ?? '')
    if (WEIBO_BAD.test(cat)) continue
    if (!WEIBO_OK.test(cat)) continue
    const title = cleanTitle(v?.word)
    if (!title || seen.has(title)) continue
    seen.add(title)
    out.push({ title, tag: '微博', url: 'https://s.weibo.com/weibo?q=' + encodeURIComponent('#' + title + '#') })
    if (out.length >= Math.max(1, Math.min(30, Number(top) || 15))) break
  }
  return out
}

/** B 站热门；接口被风控时退回站内热搜词 */
export async function fetchBili({ top = 15, fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  const n = Math.max(1, Math.min(30, Number(top) || 15))
  const j = await getJson('https://api.bilibili.com/x/web-interface/popular?ps=20&pn=1', { fetchImpl, timeoutMs, referer: 'https://www.bilibili.com/' })
  const list = j?.data?.list
  if (Array.isArray(list)) {
    const out = []
    const seen = new Set()
    for (const v of list) {
      const title = cleanTitle(v?.title)
      const bvid = String(v?.bvid ?? '')
      if (!title || seen.has(title)) continue
      if (BILI_BAD.test(title)) continue
      if (!/^BV[0-9A-Za-z]+$/.test(bvid)) continue
      seen.add(title)
      out.push({ title, tag: 'B站', url: `https://www.bilibili.com/video/${bvid}` })
      if (out.length >= n) break
    }
    if (out.length) return out
  }
  const h = await getJson('https://s.search.bilibili.com/main/hotword', { fetchImpl, timeoutMs, referer: 'https://www.bilibili.com/' })
  const words = h?.list
  if (!Array.isArray(words)) return []
  const out = []
  const seen = new Set()
  for (const v of words) {
    const title = cleanTitle(v?.keyword)
    if (!title || seen.has(title) || BILI_BAD.test(title)) continue
    seen.add(title)
    out.push({ title, tag: 'B站', url: 'https://search.bilibili.com/all?keyword=' + encodeURIComponent(title) })
    if (out.length >= n) break
  }
  return out
}

/** 微博 + B 站合并，去重，按顺序取前 top 条 */
export async function fetchHot({ top = 15, fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  const limit = Math.max(1, Math.min(30, Number(top) || 15))
  const [w, b] = await Promise.all([
    fetchWeibo({ top: limit, fetchImpl, timeoutMs }),
    fetchBili({ top: limit, fetchImpl, timeoutMs }),
  ])
  const seen = new Set()
  const out = []
  // 交替取，避免微博条目把 B 站挤没
  for (let i = 0; i < Math.max(w.length, b.length) && out.length < limit; i++) {
    for (const it of [w[i], b[i]]) {
      if (!it || seen.has(it.title)) continue
      seen.add(it.title)
      out.push(it)
      if (out.length >= limit) break
    }
  }
  return out
}

export function renderSection(items, day) {
  const lines = [`## ${day}`]
  for (const it of items) lines.push(`- ${it.tag ? '[' + it.tag + '] ' : ''}${it.title}（${it.url}）`)
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

/** 最新一天的段落，给「有人在聊梗」时按需注入 */
export function latestSectionText(maxChars = 400) {
  try {
    if (!existsSync(MEMES_FILE)) return ''
    const secs = splitSections(readFileSync(MEMES_FILE, 'utf8'))
    if (!secs.length) return ''
    return secs[0].text.slice(0, Math.max(80, Number(maxChars) || 400))
  } catch { return '' }
}

/** 到点没有？（没文件=该抓） */
export function memesDue(hours = 24, now = Date.now()) {
  try {
    const st = statSync(MEMES_FILE)
    const h = Math.max(1, Math.min(720, Number(hours) || 24))
    return now - st.mtimeMs >= h * 3600000
  } catch { return true }
}
