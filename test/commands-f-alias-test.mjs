// 命令处理里的 f 别名：以前 f 未定义，任何 # 命令都会 500（#充值 实测炸过）
import { join } from 'node:path'
import { rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const HOME = process.env.TEMP.replace(/\\/g, '/') + '/dsh-test-cmd-f'
try { rmSync(HOME, { recursive: true, force: true }) } catch {}
process.env.DSH_HOME = HOME
mkdirSync(HOME + '/profiles/desktop', { recursive: true })
writeFileSync(HOME + '/profiles/desktop/cordis.patch.yml', "- id: im-qqbot\n  config: {}\n", 'utf8')

const base = pathToFileURL(join(process.cwd(), 'lib')).href + '/'
const { ensureDirs } = await import(base + 'store.js')
const { runCommand } = await import(base + 'qq-commands.js')
const { loadConfig } = await import(base + 'config.js')
ensureDirs()

const said = []
const bot = { sendText: async (t, s) => said.push(String(s)), send: async () => {}, sendMarkdown: async (t, s) => said.push(String(s)), sendImage: async () => {}, sendFile: async () => {}, sendVoice: async () => {}, react: async () => {} }
const cfg = loadConfig()
const ctx = { bot, cfg, target: { scope: 'group', targetId: '830148935', msgId: 'm1' }, scope: 'group', peer: '830148935', sender: '2849016469', senderName: '测试人', role: 'owner', msgId: 'm1', content: '#饭', attachments: [] }
const deps = { say: (b, t, s) => said.push(String(s)), runDraw: async () => true, psRun: async () => '', ensureVoiceService: async () => null }

const ok = []
const T = (n, c, e) => ok.push([n, !!c, e])

T('#饭 不抛异常', await runCommand(ctx, '饭', '', deps) === true)
T('#饭 有回复', said.length >= 1, said.slice(0, 2))

let threw = null
try { await runCommand({ ...ctx, content: '#充值 5' }, '充值', '5', deps) } catch (e) { threw = e }
T('#充值 不抛 f is not defined', threw === null, threw && threw.message)
T('#充值 有回复', said.length >= 2, said.slice(-2))

let threw2 = null
try { await runCommand({ ...ctx, content: '#建议 多休息' }, '建议', '多休息', deps) } catch (e) { threw2 = e }
T('#建议 不抛异常', threw2 === null, threw2 && threw2.message)

let bad = 0
for (const [n, pass, e] of ok) { if (pass) console.log('OK  ' + n); else { bad++; console.log('FAIL ' + n + '  ' + String(JSON.stringify(e)).slice(0, 180)) } }
console.log(bad ? ('失败 ' + bad) : '全部通过')
process.exit(bad ? 1 : 0)
