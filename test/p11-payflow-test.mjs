/**
 * P11 支付流测试：提议 → 人拿确认码执行 → 台账；限额、重放、错误确认码
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOME = mkdtempSync(join(tmpdir(), 'dsh-p11-'))
process.env.DSH_HOME = HOME
delete process.env.QQBOT_REFINE_HOME

const url = (p) => new URL(p, import.meta.url).href
const P = await import(url('../lib/payflow.js'))
const policy = await import(url('../lib/policy.js'))
const { createGate } = await import(url('../lib/gate.js'))
const { loadConfig, saveConfig, clone, DEFAULTS, ensureStore } = await import(url('../lib/config.js'))
const { ensureDirs } = await import(url('../lib/store.js'))
const S = await import(url('../lib/state.js'))
ensureStore()
ensureDirs()
policy.ensurePolicy()
policy.setConfirmCode('2468')

const ok = []
const A = (n, p, d) => ok.push([n, !!p, d])

// 建单校验
{
  A('缺收款方被拒', P.requestPayment({ amount: 5 }).ok === false)
  A('超单笔限额被拒', P.requestPayment({ amount: 999, payee: '小明' }).ok === false)
  const r1 = P.requestPayment({ amount: 5, payee: '小明', purpose: '奶茶' })
  A('正常建单', r1.ok === true && !!r1.requestId, r1)
  const r2 = P.requestPayment({ amount: 5, payee: '小明', purpose: '奶茶', orderId: '固定单号' })
  const r3 = P.requestPayment({ amount: 5, payee: '小明', purpose: '奶茶', orderId: '固定单号' })
  A('订单号幂等', r3.ok === true && r3.dup === true, [r2, r3])
}

// 确认码
{
  const r = P.requestPayment({ amount: 6, payee: '小红' })
  const bad = P.confirmPayment(r.requestId, '0000')
  A('错确认码不执行', bad.ok === false && /不对/.test(String(bad.error || '')), bad)
  const good = P.confirmPayment(r.requestId, '2468')
  A('对确认码执行', good.ok === true, good)
  const replay = P.confirmPayment(r.requestId, '2468')
  A('重放被拒', replay.ok === false && /执行过|已执行/.test(String(replay.error || '')), replay)
}

// 群命令：模型不能付，人付
{
  const cfg = clone(DEFAULTS)
  cfg.scope.groups = ['G1']
  cfg.roles.owners = ['U-OWNER']
  cfg.frequency.mentionOnlyGroups = false
  cfg.frequency.quietEnabled = false
  cfg.memory.enabled = false
  cfg.profile.enabled = false
  cfg.sticker.enabled = false
  cfg.transport.mode = 'onebot'
  saveConfig(cfg)
  Object.assign(S.state, { muted: {}, muteCalls: {}, cooldown: {}, windows: {}, counters: {}, nm: {}, spokeAt: {}, seen: [] })

  const said = []
  const bot = { deriveReplyTarget: () => ({ scope: 'group', targetId: 'G1', msgId: '' }), sendText: async (t, b) => said.push(String(b)), sendMarkdown: async () => {}, sendImage: async () => {}, sendFile: async () => {}, sendVideo: async () => {} }
  const gate = createGate({ getConfig: loadConfig, saveConfig, diagRef: { counts: {} }, onBot: () => {}, logger: { info() {}, warn() {}, error() {} } })
  const send = (text, id, sender = 'U-OWNER') => gate.onInbound(bot, { __onebot: true, scope: 'group', peer: 'G1', sender, senderName: '主人', content: text, msgId: id })

  await send('#支付 7 小明 买书', 'c1')
  const first = said[said.length - 1] || ''
  A('命令能建单并给出单号', first.includes('单号') && first.includes('#确认支付'), first)
  const m = first.match(/单号\s+(\S+?)[，,]/)
  const rid = m ? m[1] : ''
  await send('#确认支付 ' + rid + ' 2468', 'c2')
  const second = said[said.length - 1] || ''
  A('确认后执行', second.includes('已执行'), second)
  const before = said.length
  await send('#支付 7 小明 买书', 'c3', 'U-MEMBER')
  A('普通群友不能发起支付', !(said[before] || '').includes('单号'), said[before])
}

console.log('=== P11 支付流测试 ===')
let fail = 0
for (const [n, p, d] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d))); if (!p) fail++ }
console.log(fail ? `失败 ${fail}` : '全部通过')
try { rmSync(HOME, { recursive: true, force: true }) } catch { /* ignore */ }
process.exitCode = fail ? 1 : 0
