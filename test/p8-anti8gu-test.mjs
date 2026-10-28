/**
 * P8 反八股测试：检测、重写一次、降级、关掉不碰
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-p8-'))
delete process.env.QQBOT_REFINE_HOME
const url = (p) => new URL(p, import.meta.url).href
const A = await import(url('../lib/anti8gu.js'))
const { ensureStore, clone, DEFAULTS } = await import(url('../lib/config.js'))
const { ensureDirs } = await import(url('../lib/store.js'))
ensureStore(); ensureDirs()
const ok = []
const T = (n, p, d) => ok.push([n, !!p, d])
const cfg = clone(DEFAULTS)

// 正常聊天：放行
{
  const r = A.check('在的，刚看完。你这个版本号对不上，我再看一眼。')
  T('正常人话不判八股', r.ok === true, r)
  const g = A.guard('在的，刚看完。', cfg)
  T('正常话原样放行', g.action === 'pass' && g.text === '在的，刚看完。', g)
}

// 助理腔：命中并重写
{
  const s = '首先，我们需要确认版本号；其次，要检查配置；最后，请把日志发我。希望对你有帮助！'
  const r = A.check(s)
  T('能识别分点作文', r.ok === false && r.reasons.includes('分点作文'), r)
  const g = A.guard(s, cfg)
  T('会重写一次', g.action === 'rewrite' || g.action === 'degrade', g.action)
  T('重写后没有黑名单词', !A.BANNED.some((w) => g.text.includes(w)), g.text)
}

// markdown/表格：降级
{
  const s = '| 项目 | 值 |\n|---|---|\n| a | 1 |\n\n**结论**：建议修复。'
  const r = A.check(s)
  T('能识别表格/加粗', r.ok === false && r.reasons.length > 0, r)
  const g = A.guard(s, cfg)
  T('处理后不再是稿子', A.check(g.text).ok === true || g.text.length <= cfg.anti8gu.maxChars + 1, { action: g.action, text: g.text })
}

// 超长套话：降级到前两句
{
  const s = '综上所述，' + '这个问题需要进一步深入分析。'.repeat(10)
  const g = A.guard(s, cfg)
  T('降级不超字数', g.text.length <= cfg.anti8gu.maxChars + 1, g.text.length)
  T('降级行得通', g.action === 'degrade' || g.action === 'rewrite', g.action)
}

// 开关
{
  const off = clone(cfg); off.anti8gu.enabled = false
  const g = A.guard('首先，其次，最后，希望对你有帮助。', off)
  T('关掉后原样放行', g.action === 'off' && g.text.includes('希望对你有帮助'), g)
}

// 周审计
{
  A.guard('首先，其次，最后。', cfg)
  const a = A.styleAudit(7)
  T('周审计有数字', a.checked >= 1 && a.days >= 1, a)
}

console.log('=== P8 反八股测试 ===')
let fail = 0
for (const [n, p, d] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d))); if (!p) fail++ }
console.log(fail ? `失败 ${fail}` : '全部通过')
try { rmSync(process.env.DSH_HOME, { recursive: true, force: true }) } catch {}
process.exitCode = fail ? 1 : 0
