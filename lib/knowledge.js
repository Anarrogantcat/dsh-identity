/**
 * 群知识库：稳定的资料（群规、常用链接、术语表、FAQ）
 *
 * 与另外三层分工：
 *   记忆 = 发生过的事（会淡忘）｜画像 = 群里的人｜规矩 = 禁令；知识 = 不会变的事实与资料
 *
 * 存放：<store>/knowledge/*.md
 *   common.md        所有群共享
 *   <peerKey>.md     只对某个群生效（peerKey 形如 g_6ad5415839a9）
 *
 * 检索：本地词重叠（中文二元 + 英文单词），0 token；命中了才注入人设段（上限 400 字）。
 */
import { readdirSync, readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { dirs } from './store.js'

export const KB_DIR = join(dirs.root, 'knowledge')
const MAX_CHUNK = 700
const INJECT_CHARS = 400
const DEFAULT_MIN_SCORE = 0.22

export function ensureKb() {
  if (!existsSync(KB_DIR)) { try { mkdirSync(KB_DIR, { recursive: true }) } catch { /* ignore */ } }
  if (!existsSync(join(KB_DIR, 'common.md'))) {
    try {
      writeFileSync(join(KB_DIR, 'common.md'), [
        '# 公共知识（示例，随便改）',
        '',
        '## 常用链接',
        '- 项目仓库：（填这里）',
        '',
        '## 术语',
        '- 白饭 = token（她自己的叫法）',
      ].join('\n'), 'utf8')
    } catch { /* ignore */ }
  }
  return KB_DIR
}

function cjkTokens(s) {
  const out = []
  const text = String(s ?? '').toLowerCase()
  for (const w of text.match(/[a-z0-9_]{2,}/g) ?? []) out.push(w)
  const cjk = text.replace(/[^\u4e00-\u9fa5]+/g, ' ')
  for (const run of cjk.split(/\s+/)) {
    if (!run) continue
    for (let i = 0; i < run.length - 1; i++) out.push(run.slice(i, i + 2))
    if (run.length === 1) out.push(run)
  }
  return out
}

/** 按一级/二级标题切块；没有标题就按空行分段 */
export function chunkMarkdown(peerKey, text) {
  const src = String(text ?? '').replace(/\r\n/g, '\n').trim()
  if (!src) return []
  const parts = []
  const blocks = src.split(/\n(?=#{1,2}\s)/)
  for (const b of blocks) {
    const title = (b.match(/^#{1,2}\s+([^\n]+)/)?.[1] ?? '').trim()
    let body = b.replace(/^#{1,2}\s+[^\n]*\n?/, '').trim()
    if (!body) continue
    while (body.length > MAX_CHUNK) {
      parts.push({ peerKey, title, text: body.slice(0, MAX_CHUNK) })
      body = body.slice(MAX_CHUNK)
    }
    parts.push({ peerKey, title, text: body })
  }
  return parts
}

export function loadKnowledge() {
  ensureKb()
  const chunks = []
  let files = []
  try { files = readdirSync(KB_DIR).filter((f) => f.endsWith('.md')) } catch { return { files: [], chunks } }
  for (const f of files) {
    const peerKey = f === 'common.md' ? 'common' : f.replace(/\.md$/, '')
    let text = ''
    try { text = readFileSync(join(KB_DIR, f), 'utf8') } catch { continue }
    const cs = chunkMarkdown(peerKey, text)
    for (const c of cs) chunks.push(c)
  }
  return { files, chunks }
}

/** 检索：只在本群（peerKey）+ common 里找 */
// 这些词太常见，命中了也不代表相关
const STOP = new Set(['什么', '怎么', '为什', '么是', '能不', '不能', '可以', '这个', '那个', '哪些', '在哪', '多少', '一下', '请问', '知道', '告诉'])

export function searchKnowledge(query, peerKey, { top = 3, minScore = DEFAULT_MIN_SCORE } = {}) {
  const q = String(query ?? '').trim()
  if (!q) return []
  const qTokens = [...new Set(cjkTokens(q))].filter((t) => !STOP.has(t))
  if (!qTokens.length) return []
  const { chunks } = loadKnowledge()
  const pool = chunks.filter((c) => c.peerKey === 'common' || c.peerKey === peerKey)
  const scored = []
  for (const c of pool) {
    const text = `${c.title}\n${c.text}`.toLowerCase()
    const title = String(c.title ?? '').toLowerCase()
    let hit = 0
    let titleHit = false
    for (const t of qTokens) {
      if (text.includes(t)) hit += 1
      if (title.includes(t)) titleHit = true
    }
    // 标题命中很关键（「群规是什么」这类短问句），给一点加成
    const score = hit / qTokens.length + (titleHit ? 0.2 : 0)
    if (score >= minScore) scored.push({ ...c, score: Number(score.toFixed(2)) })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, Math.max(1, top))
}

/** 注入用：命中就截一段，最多 INJECT_CHARS 字 */
export function knowledgeBlock(query, peerKey, opts = {}) {
  const hits = searchKnowledge(query, peerKey, { top: opts.top ?? 2, minScore: opts.minScore })
  if (!hits.length) return ''
  const lines = ['', '# 这个群的资料（只在与话题相关时用，别照念）']
  let budget = INJECT_CHARS
  for (const h of hits) {
    if (budget <= 0) break
    const body = h.text.slice(0, budget)
    lines.push(h.title ? `## ${h.title}` : '## 摘录')
    lines.push(body)
    budget -= body.length
  }
  return lines.join('\n')
}

/** 最近一条入站消息：人设段注入时按它检索 */
const lastQuery = new Map()
export function noteQuery(peerKey, text) {
  const t = String(text ?? '').trim().slice(0, 200)
  if (!t) return
  lastQuery.set(peerKey, t)
}
export function lastQueryOf(peerKey) {
  return lastQuery.get(peerKey) ?? ''
}

export function kbStats() {
  const { files, chunks } = loadKnowledge()
  const per = {}
  for (const c of chunks) per[c.peerKey] = (per[c.peerKey] ?? 0) + 1
  return { dir: KB_DIR, files: files.length, chunks: chunks.length, per }
}

export function listTitles(peerKey) {
  const { chunks } = loadKnowledge()
  const seen = new Set()
  const out = []
  for (const c of chunks) {
    if (c.peerKey !== 'common' && c.peerKey !== peerKey) continue
    const k = `${c.peerKey}|${c.title}`
    if (seen.has(k) || !c.title) continue
    seen.add(k)
    out.push({ file: c.peerKey === 'common' ? 'common.md' : `${c.peerKey}.md`, title: c.title })
  }
  return out
}
