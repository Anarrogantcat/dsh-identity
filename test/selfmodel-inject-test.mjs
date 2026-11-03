/**
 * 自我模型必须进提示词：以前它只在面板里出现，
 * 身份段里根本没有「我是谁、我变了什么」——连续自我是断的。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-sminj-'))
delete process.env.QQBOT_REFINE_HOME
const url = (p) => new URL(p, import.meta.url).href
const { ensureStore } = await import(url('../lib/config.js'))
const { ensureDirs } = await import(url('../lib/store.js'))
const I = await import(url('../index.js'))
ensureStore(); ensureDirs()

const ok = []
const T = (n, p, d) => ok.push([n, !!p, d])

const text = I.contextSectionText({ session: { id: 'selfmodel-inject-test' } })
T('上下文段里有自我模型', /# 自我模型/.test(text), String(text).slice(0, 200))
T('自我模型里带精力', /精力：\d+%/.test(text), String(text).match(/精力：[^\n]*/)?.[0])
T('自我模型里带时间感', /时间：现在是/.test(text), String(text).match(/时间：[^\n]*/)?.[0])

console.log('=== 自我模型注入测试 ===')
let fail = 0
for (const [n, p, d] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d))); if (!p) fail++ }
console.log(fail ? '失败 ' + fail : '全部通过')
try { rmSync(process.env.DSH_HOME, { recursive: true, force: true }) } catch {}
process.exit(fail ? 1 : 0)
