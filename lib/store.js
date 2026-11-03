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
  models: join(STORE_DIR, 'models'),
  downloads: join(STORE_DIR, 'downloads'),
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

// ── 写队列：同一路径的「读-改-写」串行 ──
//
// 单进程里同步写不会交错，真正会丢的是「先读 → await → 再写回」：中间别人写过了，
// 你手里的是旧副本，写回去就是 last-write-wins。
// 所以异步路径上改记忆，读和写必须待在同一个队列槽里（借 companion 的 enqueue 思路）。
const chains = new Map()

/** 同一路径串行执行 fn；前一个失败也继续排队。返回 fn 自己的结果/异常。 */
export function serialize(path, fn) {
  const key = String(path)
  const prev = chains.get(key) ?? Promise.resolve()
  const next = prev.then(fn, fn)
  const tail = next.then(() => {}, () => {})
  chains.set(key, tail)
  tail.then(() => { if (chains.get(key) === tail) chains.delete(key) })
  return next
}

/**
 * 异步的读-改-写：读在队列槽里现读，不拿旧副本。
 * mutate 返回 undefined 表示「只想看看，不写」。
 */
export async function updateJson(path, fallback, mutate) {
  return serialize(path, async () => {
    const cur = readJson(path, fallback)
    const next = await mutate(cur)
    if (next !== undefined) writeJson(path, next)
    return next
  })
}

/** 同步版：同一 tick 内读完就写，天然原子；替掉调用方「自己记得重读一遍」的补丁。 */
export function updateJsonSync(path, fallback, mutate) {
  const cur = readJson(path, fallback)
  const next = mutate(cur)
  if (next !== undefined) writeJson(path, next)
  return next
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
