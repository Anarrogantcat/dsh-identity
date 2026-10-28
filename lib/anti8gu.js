/**
 * 反八股（L2 风格守卫）：输出契约 + 本地检测 + 一次重写 + 降级。
 *
 * 目标：把她从「AI 助理腔」里拽出来——不列条目、不总结、不展望、不排比抒情。
 *   · 检测在出站前本地跑（0 token），命中就尝试一次机械重写
 *   · 重写后还像稿子 → 降级成前两句 + 截断，宁可短也不念稿
 *   · 只改她自己的话；不碰事实、不删用户内容
 *   · 周审计只记命中次数与样本哈希，不存全文
 */
import { join } from 'node:path'
import { readJson, writeJson, dirs, audit } from './store.js'

const PATH = () => join(dirs.root, 'anti8gu.json')

/** 助理腔/作文腔黑名单（命中越多越像稿子） */
export const BANNED = [
  '综上所述', '总的来说', '总而言之', '总之', '值得注意的是', '不难发现', '由此可见',
  '希望对你有帮助', '希望对你有所帮助', '需要我帮忙吗', '如果你需要', '如需帮助',
  '让我们', '接下来', '接下来我', '首先', '其次', '再次', '最后一点', '第一点', '第二点',
  '在当今', '在这个', '随着', '不断', '进一步', '深入', '赋能', '抓手', '闭环',
]

const BANNED_RE = new RegExp(BANNED.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g')
const MD_HEADING = /^#{1,6}\s+/m
const MD_BOLD = /\*\*[^*]+\*\*/
const MD_TABLE = /^\s*\|.+\|\s*$/m
const LIST_LINE = /^\s*(?:[-*•]|\d+[.、])\s+/m

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim()

/**
 * 检测。
 * @returns {{ok:boolean, score:number, hits:string[], reasons:string[]}}
 */
export function check(text, cfg = {}) {
  const s = String(text ?? '').trim()
  if (!s) return { ok: true, score: 0, hits: [], reasons: [] }
  const hits = [...new Set((s.match(BANNED_RE) ?? []).map((x) => x))]
  const reasons = []
  let score = hits.length
  // 「首先/其次/最后」这种结构词，单独一个可能正常，出现两个以上基本是分点作文
  const connectors = hits.filter((x) => /首先|其次|再次|最后一点|第一点|第二点/.test(x)).length
  if (connectors >= 2) { reasons.push('分点作文'); score += 1 }
  if (MD_HEADING.test(s) || MD_BOLD.test(s)) { reasons.push('markdown 排版'); score += 1 }
  if (MD_TABLE.test(s)) { reasons.push('表格'); score += 2 }
  if (LIST_LINE.test(s)) { reasons.push('列表'); score += 1 }
  // 结尾套话：帮助/需要/随时
  if (/(有帮助|帮忙吗|随时|如需|需要我)/.test(s) && s.length > 30) { reasons.push('结尾套话'); score += 1 }
  const max = Math.max(1, Math.min(10, Number(cfg?.anti8gu?.maxScore ?? 2) || 2))
  return { ok: score < max, score, hits, reasons }
}

/** 一次机械重写：去黑名单、去排版、收句号；不做语义改写 */
export function rewrite(text) {
  let s = String(text ?? '')
  s = s.replace(BANNED_RE, '')
  s = s
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/^\s*(?:[-*•]|\d+[.、])\s+/gm, '')
    .replace(/\s*\|\s*/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .replace(/^[，。；：、\s]+/, '')
    .replace(/[，、；]+$/g, '')
    .trim()
  return s
}

/** 降级：宁可短，不念稿——取前两句；仍超长就截断 */
export function degrade(text, cfg = {}) {
  const s = clean(text)
  const maxChars = Math.max(40, Number(cfg?.anti8gu?.maxChars ?? 120) || 120)
  const parts = s.split(/(?<=[。！？!?])/).filter(Boolean)
  let out = parts.slice(0, 2).join('').trim() || s
  if (out.length > maxChars) out = out.slice(0, maxChars - 1) + '…'
  return out
}

function bump(hit) {
  try {
    const j = readJson(PATH(), null)
    const db = j && typeof j === 'object' ? j : { version: 1, days: {} }
    db.days ??= {}
    const day = new Date().toISOString().slice(0, 10)
    const d = (db.days[day] ??= { checked: 0, flagged: 0, rewritten: 0, degraded: 0, reasons: {} })
    d.checked += 1
    if (hit?.flagged) d.flagged += 1
    if (hit?.rewritten) d.rewritten += 1
    if (hit?.degraded) d.degraded += 1
    for (const r of hit?.reasons ?? []) d.reasons[r] = (d.reasons[r] ?? 0) + 1
    const days = Object.keys(db.days).sort().slice(-30)
    db.days = Object.fromEntries(days.map((k) => [k, db.days[k]]))
    writeJson(PATH(), db)
  } catch { /* 统计失败不挡发送 */ }
}

/**
 * 出站前的守门：检测 →（一次）重写 → 还不行就降级。
 * @returns {{text:string, action:'pass'|'rewrite'|'degrade'|'off', score:number, reasons:string[]}}
 */
export function guard(text, cfg = {}) {
  if (cfg?.anti8gu?.enabled === false) return { text: String(text ?? ''), action: 'off', score: 0, reasons: [] }
  const first = check(text, cfg)
  if (first.ok) { bump({ checked: true }); return { text: String(text ?? ''), action: 'pass', score: first.score, reasons: first.reasons } }
  const rw = rewrite(text)
  const second = check(rw, cfg)
  if (second.ok && rw) {
    bump({ checked: true, flagged: true, rewritten: true, reasons: first.reasons })
    try { audit('anti8gu.rewrite', { reasons: first.reasons.join('/'), score: first.score }) } catch { /* ignore */ }
    return { text: rw, action: 'rewrite', score: first.score, reasons: first.reasons }
  }
  const dg = degrade(rw || text, cfg)
  bump({ checked: true, flagged: true, rewritten: true, degraded: true, reasons: first.reasons })
  try { audit('anti8gu.degrade', { reasons: first.reasons.join('/'), score: first.score }) } catch { /* ignore */ }
  return { text: dg, action: 'degrade', score: first.score, reasons: first.reasons }
}

/** 周风格审计（只读汇总） */
export function styleAudit(days = 7) {
  const j = readJson(PATH(), null)
  const d = j?.days ?? {}
  const keys = Object.keys(d).sort().slice(-Math.max(1, Number(days) || 7))
  const sum = { days: keys.length, checked: 0, flagged: 0, rewritten: 0, degraded: 0, reasons: {} }
  for (const k of keys) {
    const x = d[k]
    sum.checked += x.checked ?? 0
    sum.flagged += x.flagged ?? 0
    sum.rewritten += x.rewritten ?? 0
    sum.degraded += x.degraded ?? 0
    for (const [r, n] of Object.entries(x.reasons ?? {})) sum.reasons[r] = (sum.reasons[r] ?? 0) + n
  }
  sum.flagRate = sum.checked ? Number((sum.flagged / sum.checked).toFixed(3)) : 0
  return sum
}
