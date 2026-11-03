// 端到端：熟人一句「就这样吧」→ 共情真的被记下来（weak:true）
import { join } from 'node:path'
import { rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const HOME = process.env.TEMP.replace(/\\/g, '/') + '/dsh-test-empathy-e2e'
try { rmSync(HOME, { recursive: true, force: true }) } catch {}
process.env.DSH_HOME = HOME
mkdirSync(HOME + '/profiles/desktop', { recursive: true })
writeFileSync(HOME + '/profiles/desktop/cordis.patch.yml', "- id: im-qqbot\n  config:\n    appId: '1905982004'\n    appSecret: dummy\n", 'utf8')

const base = pathToFileURL(join(process.cwd(), 'lib')).href + '/'
const { ensureDirs } = await import(base + 'store.js')
const { createGate } = await import(base + 'channel-qq/gate.js')
const { loadConfig } = await import(base + 'config.js')
const { touchBond } = await import(base + 'bond.js')
const { STORE_DIR } = await import(base + 'config.js')
ensureDirs()

const cfg = loadConfig()
cfg.scope.groups = ['830148935']
cfg.frequency.naturalMode = true
cfg.frequency.chatMode = 'mention'
const gate = createGate({ getConfig: () => cfg, saveConfig: () => {}, diagRef: { counts: {} }, logger: { warn() {}, info() {}, error() {} }, getLlm: () => null, getClient: () => null })

const PEER = '830148935'
const SENDER = '2849016469'
// 熟人：bond ≥ 2 才认弱信号
touchBond(PEER, SENDER, { bond: 3, trust: 0.5, last: '系统测试' })

const raw = {
  __onebot: true, scope: 'group', peer: PEER, sender: SENDER, senderName: '熟人',
  content: '就这样吧', mentions: [], mentionsOther: [], images: [], attachments: [],
  msgId: 'e2e-empathy-' + Date.now(), role: 'member', recent: [],
}
const bot = { sendText: async () => {}, send: async () => {}, sendImage: async () => {}, sendMarkdown: async () => {}, sendVoice: async () => {}, react: async () => {} }
await gate.onInbound(bot, raw)

const ok = []
const T = (n, c, e) => ok.push([n, !!c, e])

let rows = []
const ef = join(STORE_DIR, 'empathy.jsonl')
try { rows = readFileSync(ef, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) } catch { rows = [] }
const mine = rows.filter((r) => String(r.cause || '').includes('就这样吧') || String(r.peer) === PEER)
T('共情记录写进 empathy.jsonl', mine.length >= 1, rows.length)
T('标了 weak:true', mine.some((r) => r.weak === true), mine)
T('情绪判成难过', mine.some((r) => r.emotion === '难过'), mine.map((r) => r.emotion))
T('bond 一起记下来', mine.some((r) => Number(r.bond) >= 2), mine.map((r) => r.bond))

// 陌生人说同一句：不该记
touchBond(PEER, '999999999', { bond: 0, trust: 0, last: '陌生人' })
const before = (() => { try { return readFileSync(ef, 'utf8').split('\n').filter(Boolean).length } catch { return 0 } })()
await gate.onInbound(bot, { ...raw, sender: '999999999', senderName: '陌生人', msgId: 'e2e-empathy-x' + Date.now() })
const after = (() => { try { return readFileSync(ef, 'utf8').split('\n').filter(Boolean).length } catch { return 0 } })()
T('陌生人说同一句不记', after === before, { before, after })

let bad = 0
for (const [n, good, e] of ok) { if (good) console.log('OK  ' + n); else { bad++; console.log('FAIL ' + n + '  ' + String(JSON.stringify(e)).slice(0, 200)) } }
console.log(bad ? ('失败 ' + bad) : '全部通过')
process.exit(bad ? 1 : 0)
