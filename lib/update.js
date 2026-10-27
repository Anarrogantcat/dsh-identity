/**
 * 自更新：查 GitHub 最新版 + 一键覆盖当前插件目录。
 *
 * 设计取舍：
 *   · **不调 pnpm**。插件可能被 pnpm 装到 node_modules/.pnpm 里，或者像本机这样
 *     用 junction 指到 ~/.dsh/plugins/…；覆盖真实目录对两种「插件目录」都成立，
 *     而 pnpm-managed 的（路径里带 .pnpm）直接拒绝，提示手动更新，别去动 store。
 *   · 下载用 codeload 的 tar.gz，解压用系统自带 tar（Win10+ 自带 bsdtar），
 *     不引任何依赖。
 *   · 覆盖前先备份到 <数据目录>/backups/update-<时间>/，失败了能回滚。
 *   · 覆盖完**必须重启 DSH** 才会加载新代码（进程里旧的模块已经加载）。
 */
import { existsSync, readFileSync, realpathSync, mkdirSync, cpSync, rmSync, writeFileSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirs, audit } from './store.js'

export const REPO = 'Anarrogantcat/dsh-qqbot-refine'
export const RAW_PKG = `https://raw.githubusercontent.com/${REPO}/master/package.json`
export const TARBALL = `https://codeload.github.com/${REPO}/tar.gz/refs/heads/master`
const CACHE_PATH = () => join(dirs.root, 'update-cache.json')
const SKIP = new Set(['node_modules', '.git', '.update-backup'])

let busy = false

/** 当前版本（读插件自己的 package.json） */
export function currentVersion() {
  try {
    const p = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json')
    return JSON.parse(readFileSync(p, 'utf8')).version ?? '0.0.0'
  } catch { return '0.0.0' }
}

/** 插件真实目录（junction / symlink 都解开） */
export function pluginDirOf() {
  try { return realpathSync(join(dirname(fileURLToPath(import.meta.url)), '..')) } catch {
    return join(dirname(fileURLToPath(import.meta.url)), '..')
  }
}

/** 1.2.3 → [1,2,3]；容忍 v 前缀和 -beta 后缀 */
export function parseVersion(v) {
  const m = String(v ?? '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)/)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/** a>b → 1；a<b → -1；相等/无法解析 → 0 */
export function compareVersions(a, b) {
  const pa = parseVersion(a), pb = parseVersion(b)
  if (!pa || !pb) return 0
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1
    if (pa[i] < pb[i]) return -1
  }
  return 0
}

/** pnpm 管着的目录不要动（会破坏 content-addressable store） */
export function isPnpmManaged(dir) {
  const s = String(dir ?? '').replace(/\\/g, '/').toLowerCase()
  return s.includes('/.pnpm/') || s.includes('/node_modules/.pnpm')
}

export function readCache() {
  try { return JSON.parse(readFileSync(CACHE_PATH(), 'utf8')) } catch { return null }
}

function writeCache(v) {
  try { mkdirSync(dirs.root, { recursive: true }); writeFileSync(CACHE_PATH(), JSON.stringify(v)) } catch { /* ignore */ }
}

/**
 * 查最新版（读 master 的 package.json，最轻）。
 * @returns {{ok:boolean, latest?:string, error?:string, checkedAt:number}}
 */
export async function checkLatest(opts = {}) {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch
  const timeoutMs = opts.timeoutMs ?? 8000
  const checkedAt = Date.now()
  try {
    const res = await fetchImpl(RAW_PKG, { signal: AbortSignal.timeout(timeoutMs), headers: { 'user-agent': 'dsh-qqbot-refine-updater' } })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const j = await res.json()
    const latest = String(j?.version ?? '')
    if (!parseVersion(latest)) throw new Error('返回里没有版本号')
    const out = { ok: true, latest, checkedAt }
    writeCache(out)
    return out
  } catch (err) {
    const out = { ok: false, error: String(err?.message ?? err).slice(0, 120), checkedAt }
    writeCache(out)
    return out
  }
}

/** 缓存超过 maxAgeMs 就重新查（面板用） */
export async function latestCached(maxAgeMs = 6 * 3600 * 1000) {
  const c = readCache()
  if (c && c.ok && Date.now() - Number(c.checkedAt ?? 0) < maxAgeMs) return c
  return checkLatest()
}

function download(file, url, fetchImpl) {
  return (async () => {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(60000), headers: { 'user-agent': 'dsh-qqbot-refine-updater' } })
    if (!res.ok) throw new Error('下载失败 HTTP ' + res.status)
    writeFileSync(file, Buffer.from(await res.arrayBuffer()))
  })()
}

/**
 * 下载最新 master 并覆盖当前插件目录。
 * @returns {{ok:boolean, from?:string, to?:string, dir?:string, backup?:string, error?:string, needManual?:boolean, needsRestart?:boolean}}
 */
export async function applyUpdate(opts = {}) {
  if (busy) return { ok: false, error: '已经在更新了' }
  busy = true
  const logger = opts.logger ?? console
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch
  const dir = opts.dir ?? pluginDirOf()
  const from = opts.from ?? currentVersion()
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const work = join(tmpdir(), 'qqbot-update-' + Date.now())
  try {
    if (isPnpmManaged(dir)) {
      return { ok: false, needManual: true, dir, error: '这个安装目录由 pnpm 管理（.pnpm），不在原地覆盖；请用 dsh plugin add 更新', from }
    }
    mkdirSync(work, { recursive: true })
    const tar = join(work, 'pkg.tar.gz')
    await download(tar, opts.tarball ?? TARBALL, fetchImpl)
    const ex = spawnSync('tar', ['-xzf', tar, '-C', work], { windowsHide: true, timeout: 120000 })
    if (ex.status !== 0) throw new Error('解压失败：' + String(ex.stderr ?? ex.error?.message ?? '').slice(0, 120))
    const top = join(work, basename(REPO).toLowerCase() + '-master')
    const src = existsSync(join(top, 'package.json')) ? top : null
    if (!src) throw new Error('解压后没找到 package.json（仓库结构变了？）')
    const next = JSON.parse(readFileSync(join(src, 'package.json'), 'utf8'))
    if (!parseVersion(next.version)) throw new Error('新版 package.json 没有版本号')

    // 备份当前目录（不含 node_modules）
    const backup = join(dirs.root, 'backups', 'update-' + ts)
    mkdirSync(backup, { recursive: true })
    cpSync(dir, backup, { recursive: true, filter: (s) => !SKIP.has(basename(s)) })

    // 覆盖（不删旧文件：多出来的旧文件留着一般无害）
    cpSync(src, dir, {
      recursive: true, force: true,
      filter: (s) => !SKIP.has(basename(s)) && !/pnpm-lock\.yaml$|\.gitignore$/.test(s),
    })
    // docs/scripts/assets 之类整目录替换，避免旧文件混淆
    for (const d of ['docs', 'scripts', 'lib', 'assets']) {
      if (existsSync(join(src, d)) && existsSync(join(dir, d))) {
        rmSync(join(dir, d), { recursive: true, force: true })
        cpSync(join(src, d), join(dir, d), { recursive: true, force: true })
      }
    }
    try { audit('update.applied', { from, to: next.version, dir: dir.slice(0, 80), backup: backup.slice(0, 80) }) } catch { /* ignore */ }
    logger?.info?.(`[qqbot-refine] 已更新 ${from} → ${next.version}（重启 DSH 生效）`)
    return { ok: true, from, to: next.version, dir, backup, needsRestart: true }
  } catch (err) {
    logger?.warn?.('[qqbot-refine] 更新失败：' + String(err?.message ?? err))
    return { ok: false, error: String(err?.message ?? err).slice(0, 160), from, dir }
  } finally {
    try { rmSync(work, { recursive: true, force: true }) } catch { /* ignore */ }
    busy = false
  }
}
