/**
 * 运行日志 + 错误日志（本地文件，不联网）
 *
 * 为什么要有它：今晚好几个 bug 都是「catch 里只 console.warn」或者
 * 干脆静默 return，日志里什么都看不到，只能靠重启加探针瞎猜。
 *
 * 文件（<store>/logs/）：
 * - app.jsonl    分级日志：debug / info / warn / error（含模型调用、链路 trace）
 * - errors.jsonl 只看错误，方便一眼扫（error 同时进 app.jsonl，查链路不用翻两个文件）
 * 规则：
 * - 去重：同 kind+msg 60 秒内只记一次（error 专用，避免刷爆盘）
 * - 轮转：单文件超 2MB 改名为 .1.jsonl（只留一份旧的）
 * - 脱敏：sk-xxx / token=xxx 这类值先替换再落盘
 */
import { join } from 'node:path'
import { appendFileSync, existsSync, renameSync, statSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirs } from './store.js'

const LOG_DIR = join(dirs.root, 'logs')
const APP = () => join(LOG_DIR, 'app.jsonl')
const ERR = () => join(LOG_DIR, 'errors.jsonl')
const MAX_BYTES = 2 * 1024 * 1024
const DEDUPE_MS = 60 * 1000
export const LEVELS = ['debug', 'info', 'warn', 'error']

const seen = new Map()
let minLevel = 'info'

export function setLevel(level) { if (LEVELS.includes(level)) minLevel = level }
export function levelIndex(l) { const i = LEVELS.indexOf(l); return i < 0 ? 1 : i }

export function redactLog(v) {
  return String(v ?? '')
    .replace(/(sk-[A-Za-z0-9_-]{6,})/g, 'sk-***')
    .replace(/((?:token|secret|key|password)\s*[=:]\s*)["']?[^\s,"'}]{6,}/gi, '$1***')
    .slice(0, 2000)
}

function rotate(path) {
  try {
    if (!existsSync(path)) return
    if (statSync(path).size <= MAX_BYTES) return
    const old = path.replace(/\.jsonl$/, '.1.jsonl')
    try { if (existsSync(old)) renameSync(old, old + '.tmp') } catch { /* ignore */ }
    renameSync(path, old)
  } catch { /* 轮转失败不影响写 */ }
}

function write(path, obj) {
  try { rotate(path); appendFileSync(path, JSON.stringify(obj) + '\n', 'utf8') } catch { /* ignore */ }
}

/** 分级日志：发生了什么（连接、重连、清理、切档…） */
export function log(level, kind, data = {}) {
  const lv = LEVELS.includes(level) ? level : 'info'
  if (levelIndex(lv) < levelIndex(minLevel)) return
  const rec = { at: new Date().toISOString(), level: lv, kind: String(kind || '') }
  for (const [k, v] of Object.entries(data || {})) {
    rec[k] = (k === 'msg' || k === 'text' || k === 'error') ? redactLog(v) : v
  }
  write(APP(), rec)
}

export const logDebug = (kind, data) => log('debug', kind, data)
export const logInfo = (kind, data) => log('info', kind, data)
export const logWarn = (kind, data) => log('warn', kind, data)
export const logRun = (kind, data) => log('info', kind, data)

/** 模型调用：谁、多慢、多少 token、成没成 */
export function logModel({ kind = 'model', provider = '', model = '', ms = 0, tokens = 0, ok = true, error = '' } = {}) {
  const data = {
    modelKind: String(kind),
    provider: String(provider || '').slice(0, 40),
    model: String(model || '').slice(0, 40),
    ms: Math.max(0, Math.round(Number(ms) || 0)),
    tokens: Math.max(0, Math.round(Number(tokens) || 0)),
    ok: !!ok,
    error: error ? redactLog(error) : '',
  }
  if (ok) logInfo('model.call', data); else logWarn('model.call', data)
}

/** 错误日志：异常是什么、在哪、几次 */
export function logError(kind, err, extra = {}) {
  const e = err instanceof Error ? err : new Error(String(err ?? 'unknown'))
  const msg = redactLog(e.message || e)
  const key = kind + '|' + msg.slice(0, 120)
  const now = Date.now()
  const hit = seen.get(key)
  if (hit && now - hit.at < DEDUPE_MS) { hit.times += 1; return }
  seen.set(key, { at: now, times: 1 })
  if (seen.size > 500) { const k = seen.keys().next().value; seen.delete(k) }
  const rec = {
    at: new Date().toISOString(),
    level: 'error',
    kind: String(kind || ''),
    msg: msg.slice(0, 300),
    code: e.code || '',
    stack: String(e.stack || '').split('\n').slice(1, 6).join('\n').slice(0, 800),
  }
  for (const [k, v] of Object.entries(extra || {})) rec[k] = typeof v === 'string' ? redactLog(v) : v
  write(ERR(), rec)
  write(APP(), { at: rec.at, level: 'error', kind: rec.kind, msg: rec.msg, code: rec.code })
}

function tailJsonl(path, limit) {
  try {
    if (!existsSync(path)) return []
    const lines = readFileSync(path, 'utf8').trim().split('\n').filter(Boolean)
    return lines.slice(-limit).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  } catch { return [] }
}

/** 面板用：按级别/关键词查日志（新的在前） */
export function queryLogs({ level = '', q = '', limit = 50 } = {}) {
  const n = Math.max(1, Math.min(500, Number(limit) || 50))
  let rows = tailJsonl(APP(), 2000)
  if (level && LEVELS.includes(level)) rows = rows.filter((r) => r.level === level)
  const kw = String(q || '').trim().toLowerCase()
  if (kw) rows = rows.filter((r) => JSON.stringify(r).toLowerCase().includes(kw))
  return rows.slice(-n).reverse()
}

export function recentErrors(limit = 30) { return tailJsonl(ERR(), Math.max(1, Math.min(200, limit))).reverse() }
export function recentRun(limit = 30) { return tailJsonl(APP(), Math.max(1, Math.min(200, limit))).reverse() }

/** 面板用：错误摘要（总数、文件大小、按 kind/level 计数） */
export function logStats() {
  const app = tailJsonl(APP(), 100000)
  const byKind = {}
  const byLevel = { debug: 0, info: 0, warn: 0, error: 0 }
  for (const r of app) {
    if (r.kind) byKind[r.kind] = (byKind[r.kind] || 0) + 1
    if (r.level in byLevel) byLevel[r.level] += 1
  }
  const size = (p) => { try { return statSync(p).size } catch { return 0 } }
  return {
    app: app.length,
    errors: tailJsonl(ERR(), 100000).length,
    run: app.length,
    byKind,
    byLevel,
    appBytes: size(APP()),
    errorBytes: size(ERR()),
    minLevel,
    files: (() => { try { return readdirSync(LOG_DIR) } catch { return [] } })(),
  }
}

/** 清空日志（保留文件本身） */
export function clearLogs() {
  let n = 0
  for (const p of [APP(), ERR()]) {
    try { if (existsSync(p)) { n += readFileSync(p, 'utf8').split('\n').filter(Boolean).length; writeFileSync(p, '') } } catch { /* ignore */ }
  }
  seen.clear()
  return n
}

let hooked = false
/** 兜住进程级异常：只记录，不吞不重抛，宿主该干嘛干嘛 */
export function installProcessHooks(logger = console) {
  if (hooked) return
  hooked = true
  try {
    process.on('uncaughtException', (err) => { logError('process.uncaught', err); try { logger.error?.('[qqbot-refine] 未捕获异常：' + (err?.message || err)) } catch { /* ignore */ } })
    process.on('unhandledRejection', (re) => { logError('process.rejection', re); try { logger.error?.('[qqbot-refine] 未处理的 Promise 拒绝：' + (re?.message || re)) } catch { /* ignore */ } })
  } catch { /* ignore */ }
}
