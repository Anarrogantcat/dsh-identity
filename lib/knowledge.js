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
 * 检索：本地词重叠（中文二元 + 英文单词），0 token；命中了才注入人设段（字数上限读 cfg.knowledge.injectChars）。
 *
 * 赛程（方案 §13 / §17.3–17.5）：数据仍住在 matches.json，但通过 provider 渲染成只读 chunk
 * 参与同一套检索 —— 一份数据，两种用法：
 *   · 结构化精确查询（#赛程 / #交手）走 lib/esports.js
 *   · 自然语言（「昨天那场谁赢了」）走这里的 esports provider
 */
import { readdirSync, readFileSync, mkdirSync, writeFileSync, existsSync, statSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { dirs, audit } from './store.js'
import { wrapUntrusted, untrustedStats } from './untrusted.js'
import { loadConfig } from './config.js'
import { chunks as esportsChunks } from './esports.js'

export const KB_DIR = join(dirs.root, 'knowledge')
const MAX_CHUNK = 700
/** 注入字数上限的缺省值（面板可改：knowledge.injectChars） */
export const DEFAULT_INJECT_CHARS = 400
const DEFAULT_MIN_SCORE = 0.22
/** 赛程 chunk 的 peerKey：像 common 一样对所有群可见，但统计单独计 */
export const ESPORTS_PEER_KEY = 'esports'

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

/** markdown 那一路（同步；loadKnowledge 与 md provider 共用） */
const KB_EXTS = ['.md', '.markdown', '.txt', '.csv', '.json', '.html', '.htm', '.pdf', '.docx', '.db', '.sqlite', '.sqlite3']
const KB_CONVERT = { '.html': 'html', '.htm': 'html', '.pdf': 'pdf', '.docx': 'docx', '.db': 'sqlite', '.sqlite': 'sqlite', '.sqlite3': 'sqlite' }
/** 调 WSL 里的转换脚本（sqlite/pdf/docx/html → 纯文本） */
function runConvert(mode, absPath, timeoutMs = 60000) {
  return new Promise((resolve) => {
    let out = ''; let err = ''; let child
    try { child = spawn('wsl', ['-d', 'Ubuntu', '-e', '/root/venv-stt/bin/python', '/root/kbimport.py', mode, String(absPath)], { windowsHide: true }) }
    catch (e) { return resolve({ ok: false, error: '启动 WSL 失败：' + String(e?.message ?? e).slice(0, 80) }) }
    const timer = setTimeout(() => { try { child.kill() } catch { /* ignore */ } ; resolve({ ok: false, error: '转换超时' }) }, timeoutMs)
    timer.unref?.()
    child.stdout?.on('data', (d) => { out += String(d) })
    child.stderr?.on('data', (d) => { err += String(d) })
    child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, error: '转换失败：' + String(e?.message ?? e).slice(0, 80) }) })
    child.on('close', (code) => {
      clearTimeout(timer)
      const text = out.trim()
      if (code === 0 && text) return resolve({ ok: true, text })
      if (text.startsWith('ERR:')) return resolve({ ok: false, error: text.slice(4).trim() })
      if (text.includes('NEED_PYPDF')) return resolve({ ok: false, error: '缺少 pypdf（WSL 里 pip install pypdf）' })
      resolve({ ok: false, error: (err || text || '转换失败（退出码 ' + code + '）').slice(0, 120) })
    })
  })
}

/** 递归列出知识库文件（支持子目录） */
function walkKb(dir = KB_DIR, base = '') {
  const out = []
  let items = []
  try { items = readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const it of items) {
    const rel = base ? base + '/' + it.name : it.name
    if (it.isDirectory()) { out.push(...walkKb(join(dir, it.name), rel)); continue }
    const lower = it.name.toLowerCase()
    if (!KB_EXTS.some((e) => lower.endsWith(e))) continue
    out.push({ rel, abs: join(dir, it.name) })
  }
  return out
}

/** csv → 「列: 值」每行一段；json → 缩进文本 */
function toTextForChunks(rel, raw) {
  const lower = rel.toLowerCase()
  if (lower.endsWith('.csv')) {
    const lines = raw.split(/\r?\n/).filter((l) => l.trim())
    if (lines.length < 2) return raw
    const head = lines[0].split(',').map((s) => s.trim().replace(/^"|"$/g, ''))
    const rows = []
    for (const line of lines.slice(1, 500)) {
      const cells = line.split(',').map((s) => s.trim().replace(/^"|"$/g, ''))
      const kv = head.map((h, i) => (cells[i] ? h + ': ' + cells[i] : '')).filter(Boolean)
      if (kv.length) rows.push(kv.join('；'))
    }
    return rows.join('\n')
  }
  if (lower.endsWith('.json')) {
    try { return JSON.stringify(JSON.parse(raw), null, 2).slice(0, 200000) } catch { return raw }
  }
  return raw
}

function htmlToText(raw) {
  return String(raw ?? '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim()
}

export function loadKnowledge() {
  ensureKb()
  const chunks = []
  const files = []
  for (const f of walkKb()) {
    let text = ''
    try { text = readFileSync(f.abs, 'utf8') } catch { continue }
    files.push(f.rel)
    // 只有 g_xxx / u_xxx 这种才是「某群/某人专属」，其它（导入的文档）一律当公共资料
    const stem = f.rel.split('/')[0].replace(/\.[^.]+$/, '')
    const peerKey = (stem === 'common' || /^[gu]_[0-9a-zA-Z]+$/.test(stem)) ? stem : 'common'
    const cs = chunkMarkdown(peerKey, toTextForChunks(f.rel, text))
    for (const c of cs) chunks.push(c)
  }
  return { files, chunks }
}
/** md 那一路的 chunk（给 provider 用，永远不抛） */
function mdChunks() {
  try { return loadKnowledge().chunks } catch { return [] }
}

/** 赛程那一路的 chunk（渲染成 {title, body, keywords}；失败就当没有） */
function safeEsportsChunks() {
  try { return esportsChunks() } catch { return [] }
}

/**
 * chunk 来源（方案 §17.3）：新增来源只要往这里加一项，检索/统计自动带上。
 *   · md      ：<store>/knowledge/*.md（每个群自己的 + common）
 *   · esports ：matches.json 渲染成只读文本（对所有群可见）
 */
export const providers = [
  { name: 'md', chunks: async () => mdChunks() },
  { name: 'esports', chunks: async () => esportsChunks() },
]

/** 把 provider 的原始 chunk 归一成检索用的形状 { peerKey, title, text, keywords } */
function normalizeChunk(name, c) {
  if (!c || typeof c !== 'object') return null
  const title = String(c.title ?? '')
  const text = String(c.text ?? c.body ?? '')
  if (!title && !text) return null
  return {
    peerKey: String(c.peerKey ?? (name === 'esports' ? ESPORTS_PEER_KEY : 'common')),
    title,
    text,
    keywords: String(c.keywords ?? ''),
  }
}

/** 合并所有 provider（异步；面板/外部用） */
export async function loadAllChunks() {
  const out = []
  for (const p of providers) {
    try {
      const cs = await p.chunks()
      for (const c of cs) {
        const n = normalizeChunk(p.name, c)
        if (n) out.push(n)
      }
    } catch { /* 单个 provider 挂掉不影响其它来源 */ }
  }
  return out
}

/** 同步版合并（检索是同步的：闸门/注入路径每轮都调，等不起 await） */
function allChunksSync() {
  const out = []
  for (const c of mdChunks()) { const n = normalizeChunk('md', c); if (n) out.push(n) }
  for (const c of safeEsportsChunks()) { const n = normalizeChunk('esports', c); if (n) out.push(n) }
  return out
}

/** 检索：本群（peerKey）+ common + 赛程 */
// 这些词太常见，命中了也不代表相关
const STOP = new Set(['什么', '怎么', '为什', '么是', '能不', '不能', '可以', '这个', '那个', '哪些', '在哪', '多少', '一下', '请问', '知道', '告诉'])

export function searchKnowledge(query, peerKey, { top = 3, minScore = DEFAULT_MIN_SCORE } = {}) {
  const q = String(query ?? '').trim()
  if (!q) return []
  const qTokens = [...new Set(cjkTokens(q))].filter((t) => !STOP.has(t))
  if (!qTokens.length) return []
  const chunks = allChunksSync()
  const pool = chunks.filter((c) => c.peerKey === 'common' || c.peerKey === peerKey || c.peerKey === ESPORTS_PEER_KEY)
  const scored = []
  for (const c of pool) {
    // keywords 也参与检索：赛程靠队名/联赛/日期命中（「昨天 IG 那场」）
    const text = `${c.title}\n${c.text}\n${c.keywords ?? ''}`.toLowerCase()
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

/** 注入字数上限：读 cfg.knowledge.injectChars，缺省 400（非法值回退缺省） */
export function injectCharsOf(cfg) {
  const n = Number(cfg?.knowledge?.injectChars ?? DEFAULT_INJECT_CHARS)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_INJECT_CHARS
  return Math.max(80, Math.min(4000, Math.round(n)))
}

function cfgSafe(opts) {
  if (opts?.cfg) return opts.cfg
  try { return loadConfig() } catch { return null }
}

/** 注入用：命中就截一段，最多 cfg.knowledge.injectChars 字 */
export function knowledgeBlock(query, peerKey, opts = {}) {
  const hits = searchKnowledge(query, peerKey, { top: opts.top ?? 2, minScore: opts.minScore })
  if (!hits.length) return ''
  const lines = ['', '# 这个群的资料（只在与话题相关时用，别照念）']
  let budget = injectCharsOf(cfgSafe(opts))
  for (const h of hits) {
    if (budget <= 0) break
    const body = h.text.slice(0, budget)
    lines.push(h.title ? `## ${h.title}` : '## 摘录')
    lines.push(body)
    budget -= body.length
  }
  const body = lines.slice(1).join('\n')
  try { const st = untrustedStats(body); if (st.hits) audit('guard.untrusted', { source: 'knowledge', hits: st.hits }) } catch { /* ignore */ }
  return wrapUntrusted('这个群的资料（只在与话题相关时用，别照念）', body)
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

/** 资料统计：md 按群分（per）；赛程单独计（esports）；providers 给各来源条数 */
export function kbStats() {
  const { files, chunks } = loadKnowledge()
  const per = {}
  for (const c of chunks) per[c.peerKey] = (per[c.peerKey] ?? 0) + 1
  const es = safeEsportsChunks().length
  return {
    dir: KB_DIR,
    files: files.length,
    chunks: chunks.length,
    per,
    providers: { md: chunks.length, esports: es },
    providerCount: providers.length,
    esports: es,
    all: chunks.length + es,
  }
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

// ── 知识库写入（面板用）：列表 / 读 / 存 / 追加 / 删 ──────────
const MAX_KB_BYTES = 256 * 1024

/** 合法文件名：common.md、g_<12位hex>.md、或普通 xxx.md（无路径分隔符） */
export function safeKbName(name) {
  const n = String(name ?? '').trim()
  if (!n || n.length > 60) return ''
  if (/[\\/]/.test(n) || n.startsWith('.')) return ''
  if (!/^[\w.\-\u4e00-\u9fa5]+\.md$/i.test(n)) return ''
  return n
}

export function listKbFiles() {
  ensureKb()
  const out = []
  let names = []
  try { names = readdirSync(KB_DIR).filter((x) => x.endsWith('.md')) } catch { return out }
  for (const name of names.sort()) {
    try {
      const st = statSync(join(KB_DIR, name))
      out.push({ file: name, bytes: st.size, mtime: st.mtimeMs, group: name.startsWith('g_') ? name.slice(2, 14) : '' })
    } catch { /* ignore */ }
  }
  return out
}

export function readKbFile(name) {
  const n = safeKbName(name)
  if (!n) return { ok: false, error: '文件名不合法' }
  ensureKb()
  const p = join(KB_DIR, n)
  if (!existsSync(p)) return { ok: false, error: '文件不存在' }
  try { return { ok: true, file: n, text: readFileSync(p, 'utf8') } } catch (e) { return { ok: false, error: String(e?.message ?? e).slice(0, 120) } }
}

export function saveKbFile(name, text, { append = false } = {}) {
  const n = safeKbName(name)
  if (!n) return { ok: false, error: '文件名不合法（只允许 xxx.md，不能带路径）' }
  const body = String(text ?? '')
  if (Buffer.byteLength(body, 'utf8') > MAX_KB_BYTES) return { ok: false, error: '内容超过 256KB' }
  ensureKb()
  const p = join(KB_DIR, n)
  try {
    if (append && existsSync(p)) {
      const old = readFileSync(p, 'utf8')
      writeFileSync(p, old.replace(/\s*$/, '') + '\n\n' + body + '\n', 'utf8')
    } else {
      writeFileSync(p, body, 'utf8')
    }
    const st = statSync(p)
    audit('knowledge.write', { file: n, bytes: st.size, append: !!append })
    return { ok: true, file: n, bytes: st.size }
  } catch (e) { return { ok: false, error: String(e?.message ?? e).slice(0, 120) } }
}

export function deleteKbFile(name) {
  const n = safeKbName(name)
  if (!n) return { ok: false, error: '文件名不合法' }
  if (n === 'common.md') return { ok: false, error: 'common.md 是默认文件，不删（可以清空内容）' }
  const p = join(KB_DIR, n)
  if (!existsSync(p)) return { ok: false, error: '文件不存在' }
  try { rmSync(p); audit('knowledge.delete', { file: n }); return { ok: true, file: n } } catch (e) { return { ok: false, error: String(e?.message ?? e).slice(0, 120) } }
}

/** 某个群对应的知识文件名：g_<peerKey hash 12 位>.md */
export function kbNameForPeer(peerKey) {
  const m = String(peerKey ?? '').match(/^([a-z])_([0-9a-f]{12})$/i)
  if (m) return 'g_' + m[2] + '.md'
  return 'common.md'
}

// ── 从外部路径导入（文件或目录；md/txt/csv/json）──────────
import { basename, extname } from 'node:path'
import { spawn } from 'node:child_process'

/** 把外部文件/目录导入知识库；目录会递归（最多 200 个文件） */
export async function importKbFromPath(srcPath, { asName = '' } = {}) {
  const src = String(srcPath ?? '').trim()
  if (!src) return { ok: false, error: '路径为空' }
  let st = null
  try { st = statSync(src) } catch { return { ok: false, error: '路径不存在：' + src } }
  const jobs = []
  const clean = (s) => String(s).replace(/[^\w.\-\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'imported'
  if (st.isDirectory()) {
    const base = clean(basename(src))
    for (const f of walkKb(src, '')) {
      if (jobs.length >= 200) break
      jobs.push({ src: f.abs, name: base + '-' + clean(f.rel.replace(/\.[^.]+$/, '')) + '.md' })
    }
  } else {
    const ext = extname(src).toLowerCase()
    if (!KB_EXTS.includes(ext)) return { ok: false, error: '不支持的文件类型：' + ext + '（支持 md/txt/csv/json/html/pdf/docx/db）' }
    const name = (asName && safeKbName(asName)) || clean(basename(src).replace(/\.[^.]+$/, '')) + '.md'
    jobs.push({ src, name })
  }
  if (!jobs.length) return { ok: false, error: '目录里没有可导入的文件' }
  let imported = 0
  const errors = []
  for (const j of jobs) {
    try {
      const ext = extname(j.src).toLowerCase()
      const mode = KB_CONVERT[ext]
      let text = ''
      if (ext === '.html' || ext === '.htm') {
        text = htmlToText(readFileSync(j.src, 'utf8'))
      } else if (mode) {
        const conv = await runConvert(mode, j.src)
        if (!conv.ok) { errors.push(basename(j.src) + '：' + conv.error); continue }
        text = conv.text
      } else {
        text = toTextForChunks(j.src, readFileSync(j.src, 'utf8'))
      }
      const r = saveKbFile(j.name, text)
      if (r.ok) imported += 1
      else errors.push(j.name + '：' + r.error)
    } catch (e) { errors.push(basename(j.src) + '：' + String(e?.message ?? e).slice(0, 60)) }
  }  audit('knowledge.import', { src: src.slice(0, 120), imported, errors: errors.length })
  return { ok: imported > 0, imported, total: jobs.length, errors: errors.slice(0, 5) }
}
