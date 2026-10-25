/** 通用存储：原子写 JSON、按 peer 分目录、内容哈希 */
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync, readdirSync, unlinkSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { STORE_DIR } from './config.js'

export const dirs = {
  root: STORE_DIR,
  peers: join(STORE_DIR, 'peers'),
  memory: join(STORE_DIR, 'memory'),
  profiles: join(STORE_DIR, 'profiles'),
  stickers: join(STORE_DIR, 'stickers'),
  remote: join(STORE_DIR, 'stickers', 'remote'),
  collected: join(STORE_DIR, 'stickers', 'collected'),
  generated: join(STORE_DIR, 'stickers', 'generated'),
  bili: join(STORE_DIR, 'bili'),
  tmp: join(STORE_DIR, 'tmp'),
  logs: join(STORE_DIR, 'logs'),
}

export function ensureDirs() {
  for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true })
}

export function readJson(path, fallback) {
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return fallback }
}

export function writeJson(path, obj) {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`
  writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8')
  renameSync(tmp, path)
}

export function appendJsonl(path, obj) {
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${JSON.stringify(obj)}\n`, { flag: 'a' })
  } catch { /* 审计失败不影响主流程 */ }
}

export const sha = (s, n = 16) => createHash('sha256').update(String(s)).digest('hex').slice(0, n)

export function peerKey(scope, peer) {
  return `${scope === 'group' ? 'g' : 'u'}_${sha(peer, 12)}`
}

export function audit(kind, data) {
  appendJsonl(join(dirs.logs, 'audit.jsonl'), { at: new Date().toISOString(), kind, ...data })
}

export function cleanupTmp(maxAgeMs = 24 * 3600 * 1000) {
  try {
    const now = Date.now()
    for (const f of readdirSync(dirs.tmp)) {
      const p = join(dirs.tmp, f)
      try { if (now - statSync(p).mtimeMs > maxAgeMs) unlinkSync(p) } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}

export { existsSync, readdirSync, unlinkSync, statSync }
