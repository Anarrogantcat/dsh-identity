/**
 * 出站日志：拆气泡时只记「真正发出去的第一条」，不能把拆之前的全文再记一遍
 * （以前日志里一条消息出现两遍，复盘/摘要会重复计数）
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const HOME = join(tmpdir(), 'dsh-log-split-' + Date.now())
process.env.DSH_HOME = HOME
delete process.env.QQBOT_REFINE_HOME
try { rmSync(HOME, { recursive: true, force: true }) } catch { /* ignore */ }
mkdirSync(HOME + '/profiles/desktop', { recursive: true })
writeFileSync(HOME + '/profiles/desktop/cordis.patch.yml', "- id: im-qqbot\n  config:\n    appId: '1905982004'\n    appSecret: dummy-secret-for-test\n", 'utf8')

const base = new URL('../', import.meta.url).href
const { createGate } = await import(base + 'lib/gate.js')
const { loadConfig, saveConfig, clone, DEFAULTS } = await import(base + 'lib/config.js')
const { ensureDirs, peerKey } = await import(base + 'lib/store.js')
const { readEvents } = await import(base + 'lib/events.js')
ensureDirs()

const cfg = clone(DEFAULTS)
Object.assign(cfg.frequency, { typingEnabled: false, maxRepliesPerTurn: 2, splitMinChars: 10 })
cfg.sticker.enabled = false
cfg.memory.enabled = false
cfg.privacy.enabled = false
cfg.learn = { ...(cfg.learn || {}), enabled: false }
saveConfig(cfg)

const bot = { sendText: async () => {}, sendMarkdown: async () => {}, sendImage: async () => {} }
const gate = createGate({ getConfig: loadConfig, saveConfig, diagRef: { counts: { markers: 0 } }, onBot() {}, logger: { info() {}, warn() {}, error() {} } })
const target = { scope: 'group', targetId: 'G1' }
const PK = peerKey('group', 'G1')

const ok = []
const A = (n, p, d) => ok.push([n, !!p, d])
const FULL = '第一句话在这里呀。第二句话也在这里。'
const r = await gate.onOutbound(bot, 'sendText', [target, FULL])
const sent = r?.args?.[1] ?? ''
const evs = readEvents(PK).filter((e) => e.origin === 'bot')

A('确实拆成了两条发', sent !== FULL, { sent })
A('发出去的第一条就是拆后的第一句', sent === '第一句话在这里呀。', sent)
A('日志只记了 1 条（没记拆前全文）', evs.length === 1, evs.map((e) => e.text))
A('日志里那条是真正发出去的第一句', evs[0]?.text === '第一句话在这里呀。', evs[0]?.text)
A('日志里没有"全文那条"', !evs.some((e) => String(e.text).includes('第二句话也在这里')), evs.map((e) => e.text))

console.log('=== 出站日志拆分测试 ===')
let fail = 0
for (const [n, p, d] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d))); if (!p) fail++ }
console.log(fail ? `失败 ${fail}` : '全部通过')
try { rmSync(HOME, { recursive: true, force: true }) } catch { /* ignore */ }
process.exitCode = fail ? 1 : 0
