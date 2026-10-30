/**
 * [[correct: 旧的 => 新的]] 出站标记：剥离、旧条作废、新条记成群友说的（by 取这一轮在回谁）
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const HOME = join(tmpdir(), 'dsh-correct-marker-' + Date.now())
process.env.DSH_HOME = HOME
delete process.env.QQBOT_REFINE_HOME
try { rmSync(HOME, { recursive: true, force: true }) } catch { /* ignore */ }
mkdirSync(HOME + '/profiles/desktop', { recursive: true })
writeFileSync(HOME + '/profiles/desktop/cordis.patch.yml', "- id: im-qqbot\n  config:\n    appId: '1905982004'\n    appSecret: dummy-secret-for-test\n", 'utf8')

const base = new URL('../', import.meta.url).href
const { createGate } = await import(base + 'lib/gate.js')
const { loadConfig, saveConfig, clone, DEFAULTS } = await import(base + 'lib/config.js')
const { ensureDirs, peerKey } = await import(base + 'lib/store.js')
const { addMemory, listMemory } = await import(base + 'lib/memory.js')
const { markReplyTo } = await import(base + 'lib/state.js')
ensureDirs()

const cfg = clone(DEFAULTS)
Object.assign(cfg.frequency, { typingEnabled: false })
cfg.sticker.enabled = false
cfg.privacy.enabled = false
cfg.memory.enabled = true
saveConfig(cfg)

const PK = peerKey('group', 'G1')
addMemory(PK, { text: '小明下周三考试', category: 'fact', importance: 0.8, origin: 'user', by: 'u1001' }, loadConfig())
markReplyTo('G1', 'u1001')

const diagRef = { counts: { markers: 0 } }
const bot = { sendText: async () => {}, sendMarkdown: async () => {}, sendImage: async () => {} }
const gate = createGate({ getConfig: loadConfig, saveConfig, diagRef, onBot() {}, logger: { info() {}, warn() {}, error() {} } })
const target = { scope: 'group', targetId: 'G1' }

const ok = []
const A = (n, p, d) => ok.push([n, !!p, d])

const r = await gate.onOutbound(bot, 'sendText', [target, '记错了，下周四是考试 [[correct: 下周三考试 => 小明下周四考试]]'])
const sent = r?.args?.[1] ?? ''
A('标记被剥掉不发给群', !sent.includes('[['), sent)
A('标记计数 +1', diagRef.counts.markers === 1, diagRef.counts.markers)

const items = listMemory(PK)
const old = items.find((x) => x.text === '小明下周三考试')
const fresh = items.find((x) => x.text === '小明下周四考试')
A('旧条作废', old?.status === 'superseded' && old.supersededBy === fresh?.id, old)
A('新条生效并指回旧条', fresh?.status === 'active' && fresh.supersedes === old?.id, fresh)
A('新条记成群友说的', fresh?.origin === 'user' && fresh?.by === 'u1001', { origin: fresh?.origin, by: fresh?.by })

// 没有 => 的写法不乱动
const before = listMemory(PK).length
await gate.onOutbound(bot, 'sendText', [target, '随便说说 [[correct: 这条没有箭头]]'])
A('缺箭头的标记不硬改', listMemory(PK).length === before, listMemory(PK).length)

// 出站承诺记账：这一段以前引用了入站帧 f，ReferenceError 被吞，承诺全丢
{
  const { listPromises } = await import(base + 'lib/promises.js')
  await gate.onOutbound(bot, 'sendText', [target, '我明天帮你看看那个配置'])
  const ps = listPromises({ peerKey: PK })
  A('她答应的事能记下来', ps.some((p) => String(p.text ?? '').includes('明天帮你')), ps)
}

console.log('=== 改口标记测试 ===')
let fail = 0
for (const [n, p, d] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d))); if (!p) fail++ }
console.log(fail ? `失败 ${fail}` : '全部通过')
try { rmSync(HOME, { recursive: true, force: true }) } catch { /* ignore */ }
process.exitCode = fail ? 1 : 0
