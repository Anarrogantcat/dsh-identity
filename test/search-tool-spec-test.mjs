/**
 * QQ 会话影子 web_search：注册定义要带 output.schema + output.render（DSH 0.2.1 强制），
 * 且第二次调用不重复注册。
 */
import { join } from 'node:path'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

process.env.DSH_HOME = join(tmpdir(), 'dsh-search-tool-' + Date.now())
try { rmSync(process.env.DSH_HOME, { recursive: true, force: true }) } catch { /* ignore */ }
mkdirSync(process.env.DSH_HOME + '/profiles/desktop', { recursive: true })

const base = new URL('../', import.meta.url).href
const T = await import(base + 'lib/toolgate.js')
const { ensureDirs } = await import(base + 'lib/store.js')
const { clone, DEFAULTS } = await import(base + 'lib/config.js')
ensureDirs()
const cfg = clone(DEFAULTS)

const ok = []
const A = (n, p, d) => ok.push([n, !!p, d])

let captured = null
let registered = 0
const fakeTools = {
  get: () => null,
  register: (def) => { captured = def; registered += 1; return () => {} },
}
const agent = { ctx: { tools: fakeTools } }
const n1 = T.ensureSearchTool(agent, () => cfg)
A('第一次注册成功', n1 === 1 && registered === 1, { n1, registered })
A('定义了 output.schema', captured?.output?.schema?.type === 'json', captured?.output?.schema)
A('定义了 output.render', typeof captured?.output?.render === 'function', typeof captured?.output?.render)
A('参数要求 query', captured?.parameters?.required?.includes('query'), captured?.parameters)

const parts = captured.output.render({ query: 'x' }, '搜索结果')
A('render 返回 text 片段', Array.isArray(parts) && parts[0]?.type === 'text' && parts[0]?.text === '搜索结果', parts)
const partsObj = captured.output.render({}, { a: 1 })
A('render 能渲染对象结果', partsObj[0]?.text?.includes('"a": 1'), partsObj)

A('有 execute', typeof captured?.execute === 'function')
const empty = await captured.execute({ query: '   ' })
A('空查询直接回提示，不联网', empty === '（空查询）', empty)

const n2 = T.ensureSearchTool(agent, () => cfg)
A('第二次不重复注册', n2 === 0 && registered === 1, { n2, registered })

// 注册要留痕（重启后能查"到底挂上没有"）
{
  const { readFileSync, existsSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { dirs } = await import(base + 'lib/store.js')
  const ap = join(dirs.logs, 'audit.jsonl')
  const txt = existsSync(ap) ? readFileSync(ap, 'utf8') : ''
  A('注册写了审计', /"kind":"tools\.register"|"kind": "tools\.register"/.test(txt) || txt.includes('tools.register'), txt.slice(-200))
}

// 拿不到 tools.register 时返回 0 并留痕
const badAgent = { ctx: { tools: {} } }
const n3 = T.ensureSearchTool(badAgent, () => cfg)
A('没有 register 时不崩', n3 === 0 && /register/.test(String(T.toolGate.lastToolError)), T.toolGate.lastToolError)

console.log('=== QQ 会话 web_search 注册测试 ===')
let fail = 0
for (const [n, p, d] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d))); if (!p) fail++ }
console.log(fail ? `失败 ${fail}` : '全部通过')
try { rmSync(process.env.DSH_HOME, { recursive: true, force: true }) } catch { /* ignore */ }
process.exitCode = fail ? 1 : 0
