// 日志系统：分级、去重、模型调用、过滤查询、脱敏、清空
import { join } from 'node:path'
import { rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const HOME = process.env.TEMP.replace(/\\/g, '/') + '/dsh-test-diaglog'
try { rmSync(HOME, { recursive: true, force: true }) } catch {}
process.env.DSH_HOME = HOME
mkdirSync(HOME + '/profiles/desktop', { recursive: true })
writeFileSync(HOME + '/profiles/desktop/cordis.patch.yml', "- id: dsh-identity\n  config: {}\n", 'utf8')

const base = pathToFileURL(join(process.cwd(), 'lib')).href + '/'
const { ensureDirs } = await import(base + 'store.js')
const L = await import(base + 'diaglog.js')
ensureDirs()

const ok = []
const T = (n, c, e) => ok.push([n, !!c, e])

// 错误：去重 + 堆栈
L.logError('gate.test', new Error('boom one'), { peer: 'p1' })
L.logError('gate.test', new Error('boom one'), { peer: 'p1' })
L.logError('gate.test', new Error('boom two'))
const errs = L.recentErrors(10)
T('同类同消息去重（2 条）', errs.length === 2, errs.map((e) => e.msg))
T('最近的在前', errs[0].msg === 'boom two', errs.map((e) => e.msg))
T('带 stack 与 level', !!errs[0].stack && errs[0].level === 'error', errs[0])

// 分级 + 过滤（debug 默认被压，先打开）
L.setLevel('debug')
L.logInfo('boot', { text: 'started' })
L.logWarn('model.call', { modelKind: 'judge', provider: 'p', model: 'm', ms: 12, tokens: 5, ok: false, error: 'timeout' })
L.logDebug('noise', { text: 'debug-only' })
const onlyErr = L.queryLogs({ level: 'error', limit: 20 })
T('按级别只出 error', onlyErr.length === 2 && onlyErr.every((r) => r.level === 'error'), onlyErr.map((r) => r.level))
T('关键词能搜到 debug 行', L.queryLogs({ q: 'debug-only' }).length === 1)
T('关键词能搜模型名', L.queryLogs({ q: 'judge' }).length >= 1)
T('新日志倒序', L.queryLogs({ limit: 1 })[0].kind === 'noise', L.queryLogs({ limit: 1 }))

// 模型调用记录
L.logModel({ kind: 'judge', provider: 'deepseek', model: 'flash', ms: 321, tokens: 88, ok: true })
const mc = L.queryLogs({ q: 'model.call', limit: 10 })
T('模型调用落盘（成功+失败）', mc.length === 2, mc.map((r) => r.ok))

// 脱敏
L.logInfo('secret.leak', { text: 'token=abcdef123456 and sk-ABCDEF123456' })
const leak = L.queryLogs({ q: 'secret.leak', limit: 1 })[0] || {}
const leakStr = JSON.stringify(leak)
T('token 被脱敏', !/abcdef123456/.test(leakStr) && /token=\*\*\*/.test(leakStr), leak.text)
T('sk- 被脱敏', !/sk-ABCDEF123456/.test(leakStr), leak.text)

// 统计
const st = L.logStats()
T('按 level 计数', (st.byLevel.error || 0) >= 2 && (st.byLevel.info || 0) >= 2, st.byLevel)
T('按 kind 计数', (st.byKind['gate.test'] || 0) === 2, st.byKind)

// 清空
const n = L.clearLogs()
T('清空返回条数', n > 0, n)
T('清空后没有日志', L.queryLogs({ limit: 5 }).length === 0 && L.recentErrors(5).length === 0)

// 业务数据里的 kind/level 不许覆盖日志保留字段（曾把 mood.note 写成 kind=text）
L.logInfo('mood.keep', { kind: 'text', level: 'error', at: 'x', role: 'member', changed: ['anger'] })
const kept = L.queryLogs({ q: 'mood.keep', limit: 5 })
T('保留字段不被覆盖（kind）', kept.length === 1 && kept[0].kind === 'mood.keep', kept[0] && kept[0].kind)
T('保留字段不被覆盖（level）', kept.length === 1 && kept[0].level === 'info', kept[0] && kept[0].level)
T('普通字段照常带上', kept.length === 1 && kept[0].role === 'member', kept[0] && kept[0].role)
let bad = 0
for (const [name, good, e] of ok) {
  if (good) console.log('OK  ' + name)
  else { bad++; console.log('FAIL ' + name + '  ' + String(JSON.stringify(e)).slice(0, 260)) }
}
console.log(bad ? ('失败 ' + bad) : '全部通过')
process.exit(bad ? 1 : 0)
