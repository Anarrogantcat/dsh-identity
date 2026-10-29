/**
 * P14 收尾测试：小黑盒能力（CLI 缺失/空查询）+ 身份接管回滚开关 + 显示名
 */
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-p14-'))
delete process.env.QQBOT_REFINE_HOME
process.env.XIAOHEIHE_CLI = 'definitely-not-a-real-cli-xyz'
const url = (p) => new URL(p, import.meta.url).href
const X = await import(url('../lib/xiaoheihe.js'))
const C = await import(url('../lib/caprun.js'))
await import(url('../lib/caps-default.js'))
const { ensureStore, clone, DEFAULTS } = await import(url('../lib/config.js'))
const { ensureDirs } = await import(url('../lib/store.js'))
ensureStore(); ensureDirs()
const ok = []
const T = (n, p, d) => ok.push([n, !!p, d])
const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// 小黑盒：CLI 缺失/空查询都给明确码
{
  T('空查询被拒', (await X.query('')).code === 'empty_query')
  const r = await X.query('黑神话')
  T('CLI 缺失给 cli_missing', r.ok === false && (r.code === 'cli_missing' || r.code === 'cli_failed'), r)
  const c = C.listCapabilities().map((x) => x.id)
  T('小黑盒已注册成能力', c.includes('xiaoheihe.query'), c)
  const run = await C.runCapability('xiaoheihe.query', { keyword: 'x' })
  T('能力层透出失败码', run.ok === false && ['cli_missing', 'cli_failed'].includes(run.code), run)
}

// 身份接管回滚开关
{
  const cfg = clone(DEFAULTS)
  T('默认接管开', cfg.identity.takeover === true)
  cfg.identity.takeover = false
  T('关掉接管就是回滚', cfg.identity.takeover === false)
}

// 显示名（面板标题/页头）
{
  const html = readFileSync(join(root, 'panel.html'), 'utf8')
  T('面板标题是身份系统', html.includes('<title>大肥鱼 · 身份系统</title>'))
  T('页头是身份系统', html.includes('身份系统') && html.includes('class="tag"'))
  T('身份页有承诺卡片', html.includes('没做完的承诺') && html.includes('data-pclose'))
  T('身份页有复盘卡片', html.includes('最近复盘') && html.includes('reflRows'))
  T('面板后端有承诺动作', readFileSync(join(root, 'index.js'), 'utf8').includes('promiseClose'))
}

console.log('=== P14 收尾测试 ===')
let fail = 0
for (const [n, p, d] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d))); if (!p) fail++ }
console.log(fail ? `失败 ${fail}` : '全部通过')
try { rmSync(process.env.DSH_HOME, { recursive: true, force: true }) } catch {}
process.exitCode = fail ? 1 : 0
