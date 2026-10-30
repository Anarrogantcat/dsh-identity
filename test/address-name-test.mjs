/**
 * 称呼设置：identity.addressName 要真的进身份段，
 * 留空时回退名册/不出现。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-address-'))
delete process.env.QQBOT_REFINE_HOME

const url = (p) => new URL(p, import.meta.url).href
const { ensureStore, loadConfig, saveConfig, clone } = await import(url('../lib/config.js'))
const { ensureDirs } = await import(url('../lib/store.js'))
const I = await import(url('../index.js'))
ensureStore(); ensureDirs()

const ctx = { session: { id: 'web-address-sess-1' } }
const before = I.identitySectionText(ctx)

const cfg = clone(loadConfig())
cfg.identity.addressName = '染喵'
saveConfig(cfg)
const after = I.identitySectionText(ctx)

const cfg2 = clone(loadConfig())
cfg2.identity.addressName = ''
saveConfig(cfg2)
const reset = I.identitySectionText(ctx)

const ok = []
const T = (n, p, d) => ok.push([n, !!p, d])
T('填了称呼就进身份段', after.includes('染喵'), after)
T('留空就不出现「染喵」', !reset.includes('染喵'), reset)
T('默认不炸', typeof before === 'string')

console.log('=== 称呼设置测试 ===')
let fail = 0
for (const [n, p, d] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d))); if (!p) fail++ }
console.log(fail ? '失败 ' + fail : '全部通过')
try { rmSync(process.env.DSH_HOME, { recursive: true, force: true }) } catch {}
process.exit(fail ? 1 : 0)
