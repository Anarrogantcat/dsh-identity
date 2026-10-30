/**
 * 孤儿浏览器清理：只认 Temp\payqr-edge-*，不碰真实浏览器
 * （历史事故：测试泄漏 747 个 msedge、35 GB 工作集，把机器拖到内存压缩）
 */
import { mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOME = mkdtempSync(join(tmpdir(), 'dsh-cleanup-'))
process.env.DSH_HOME = HOME
delete process.env.QQBOT_REFINE_HOME

const base = new URL('../', import.meta.url).href
const { ensureStore } = await import(base + 'lib/config.js')
const { ensureDirs } = await import(base + 'lib/store.js')
const C = await import(base + 'lib/cleanup.js')
ensureStore(); ensureDirs()

const ok = []
const A = (n, p, d) => ok.push([n, !!p, d])

// 只认我们自己的前缀
A('认 payqr-edge- 前缀', C.isOrphanProfileDir('payqr-edge-1793274734579') === true)
A('别的前缀不动', C.isOrphanProfileDir('dsh-something') === false)
A('空/非字符串不炸', C.isOrphanProfileDir('') === false && C.isOrphanProfileDir(null) === false)

// 老的临时目录会被清，新的保留
{
  const oldDir = join(tmpdir(), C.ORPHAN_PREFIX + 'old-' + Date.now())
  const freshDir = join(tmpdir(), C.ORPHAN_PREFIX + 'fresh-' + Date.now())
  const otherDir = join(tmpdir(), 'not-ours-' + Date.now())
  mkdirSync(oldDir, { recursive: true })
  mkdirSync(freshDir, { recursive: true })
  mkdirSync(otherDir, { recursive: true })
  // 把 oldDir 的 mtime 拨到 2 小时前
  const { utimesSync } = await import('node:fs')
  const past = (Date.now() - 2 * 3600000) / 1000
  utimesSync(oldDir, past, past)
  const n = C.sweepOrphanProfiles({ maxAgeMs: 3600000, logger: { info() {} } })
  A('清掉了老的临时目录', !existsSync(oldDir) && n >= 1, { n })
  A('新的临时目录还在', existsSync(freshDir))
  A('不是我们的目录没动', existsSync(otherDir))
  try { rmSync(freshDir, { recursive: true, force: true }); rmSync(otherDir, { recursive: true, force: true }) } catch { /* ignore */ }
}

// 非 Windows 上不瞎杀
if (process.platform !== 'win32') {
  A('非 Windows 不做进程清理', C.killOrphanBrowsers({ logger: { info() {} } }) === false)
} else {
  A('Windows 上能返回处理标记', typeof C.killOrphanBrowsers({ logger: { info() {} } }) === 'boolean')
}

console.log('=== 孤儿浏览器清理测试 ===')
let fail = 0
for (const [n, p, d] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d))); if (!p) fail++ }
console.log(fail ? `失败 ${fail}` : '全部通过')
try { rmSync(HOME, { recursive: true, force: true }) } catch { /* ignore */ }
process.exitCode = fail ? 1 : 0
