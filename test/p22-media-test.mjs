/**
 * P22 媒体发送能力：统一契约 + 策略闸 + 失败码
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-p22-'))
delete process.env.QQBOT_REFINE_HOME
const HOME = process.env.DSH_HOME
const url = (p) => new URL(p, import.meta.url).href
const { ensureStore, clone, DEFAULTS, saveConfig } = await import(url('../lib/config.js'))
const { ensureDirs } = await import(url('../lib/store.js'))
ensureStore(); ensureDirs()
const C = await import(url('../lib/caprun.js'))
await import(url('../lib/caps-default.js'))
const P = await import(url('../lib/policy.js'))
P.ensurePolicy()
const cfg = clone(DEFAULTS)
saveConfig(cfg)
const ok = []
const T = (n, p, d) => ok.push([n, !!p, d])

const img = join(HOME, 'x.png')
writeFileSync(img, 'fake-png')
const sent = []
const bot = { sendImage: async (t, b) => sent.push(['img', b]), sendFile: async (t, b) => sent.push(['file', b]), sendVideo: async () => {} }
const target = { scope: 'group', targetId: 'G1', msgId: '' }

const r1 = await C.runCapability('media.send', { bot, target, localPath: img }, { cfg })
T('能发图', r1.ok && sent.length === 1 && sent[0][0] === 'img', r1)
const r2 = await C.runCapability('media.send', { bot, target, localPath: img, kind: 'file' }, { cfg })
T('能发文件', r2.ok && sent[1][0] === 'file', r2)
const r3 = await C.runCapability('media.send', { target, localPath: img }, { cfg })
T('缺发送器给明确码', r3.ok === false && r3.code === 'no_sender', r3)

// 策略关掉 → 不发
P.setConfirmCode('2468')
const req = P.requestChange({ actions: { 'media.send': 'off' } }, { by: 'owner' })
P.applyChange(req.id, '2468', { by: 'owner' })
const before = sent.length
const r4 = await C.runCapability('media.send', { bot, target, localPath: img }, { cfg })
T('策略 off 拦住发送', r4.ok === false && r4.code === 'disabled' && sent.length === before, r4)

console.log('=== P22 媒体能力测试 ===')
let fail = 0
for (const [n, p, d] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d))); if (!p) fail++ }
console.log(fail ? '失败 ' + fail : '全部通过')
try { rmSync(HOME, { recursive: true, force: true }) } catch {}
process.exit(fail ? 1 : 0)
