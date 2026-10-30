/**
 * 自我模型要跟着自定义内核走，不能永远念内置那套。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-selfmodel-'))
delete process.env.QQBOT_REFINE_HOME

const url = (p) => new URL(p, import.meta.url).href
const { ensureStore, loadConfig, saveConfig, clone } = await import(url('../lib/config.js'))
const { ensureDirs } = await import(url('../lib/store.js'))
const { buildSelfModel } = await import(url('../lib/selfmodel.js'))
ensureStore(); ensureDirs()

const before = buildSelfModel().text
const cfg = clone(loadConfig())
cfg.identity.baseText = '你是「测试鲸鱼」，一只临时工鲸鱼娘。'
saveConfig(cfg)
const after = buildSelfModel().text

const cfg2 = clone(loadConfig())
cfg2.identity.baseText = ''
saveConfig(cfg2)
const reset = buildSelfModel().text

const ok = []
const T = (n, p, d) => ok.push([n, !!p, d])
T('默认用内置内核', before.includes('大肥鱼'), before.slice(0, 80))
T('自定义内核进自我模型', after.includes('测试鲸鱼') && !after.includes('大肥鱼'), after.slice(0, 120))
T('清空后回退内置', reset.includes('大肥鱼'), reset.slice(0, 80))

console.log('=== 自我模型内核跟随测试 ===')
let fail = 0
for (const [n, p, d] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d))); if (!p) fail++ }
console.log(fail ? '失败 ' + fail : '全部通过')
try { rmSync(process.env.DSH_HOME, { recursive: true, force: true }) } catch {}
process.exit(fail ? 1 : 0)
