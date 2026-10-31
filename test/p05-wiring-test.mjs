/**
 * P0.5 接线测试：身份注入 / 事件落盘 / 策略闸 / 去装饰旋钮
 *
 * 全部 import 仓库源码（不碰部署目录），DSH_HOME 指向临时目录。
 */
import { mkdtempSync, rmSync, writeFileSync, statSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOME = mkdtempSync(join(tmpdir(), 'dsh-p05-'))
process.env.DSH_HOME = HOME
delete process.env.QQBOT_REFINE_HOME

const url = (p) => new URL(p, import.meta.url).href
const { composeIdentity, kernelText, kernelSummary, KERNEL } = await import(url('../lib/identity.js'))
const { createGate } = await import(url('../lib/gate.js'))
const { loadConfig, saveConfig, clone, DEFAULTS, ensureStore } = await import(url('../lib/config.js'))
const { ensureDirs, peerKey, dirs, sha } = await import(url('../lib/store.js'))
const events = await import(url('../lib/events.js'))
const policy = await import(url('../lib/policy.js'))
const privacy = await import(url('../lib/privacy.js'))
const usage = await import(url('../lib/usage.js'))
const sticker = await import(url('../lib/sticker.js'))
const profile = await import(url('../lib/profile.js'))
const S = await import(url('../lib/state.js'))

ensureStore()
ensureDirs()
policy.ensurePolicy()

const ok = []
const A = (name, pass, detail) => ok.push([name, !!pass, detail])
const silent = { info() {}, warn() {}, error() {} }
const log = () => {}

// ── 1. 身份内核 ──
{
  const t = kernelText()
  A('内核含名字与物种', t.includes('大肥鱼') && t.includes('鲸鱼娘'), t.slice(0, 40))
  A('内核含价值观与边界', t.includes('说实话') && t.includes('不泄露隐私'))
  A('内核提到不装人', t.includes('不装人'))
  const g = composeIdentity({ scope: 'group' })
  const d = composeIdentity({ scope: 'c2c' })
  A('身份注入 ≤900 字', g.used <= 900 && d.used <= 900, [g.used, d.used])
  A('群聊/私聊场景不同', g.text !== d.text)
  A('预算被严格执行', composeIdentity({ scope: 'group', maxChars: 500 }).used <= 500)
  const long = composeIdentity({ scope: 'group', maxChars: 900, parts: [{ name: 'x', text: 'y'.repeat(3000) }] })
  A('超长动态段被截断', long.used <= 900)
  A('摘要结构完整', kernelSummary().name === KERNEL.name && kernelSummary().chars <= 900)
  A('身份模型是基础人设+成长', composeIdentity({ scope: 'group' }).text.includes('大肥鱼'))
}

// ── 2. 事件流：入站/出站/幂等/政策闸 ──
const PK = peerKey('group', 'G1')
{
  const cfg = clone(DEFAULTS)
  cfg.scope.groups = ['G1']
  cfg.roles.owners = ['U-OWNER']
  cfg.frequency.mentionOnlyGroups = false
  cfg.frequency.naturalMode = true
  cfg.frequency.quietEnabled = false
  cfg.frequency.aliases = ['大肥鱼']
  cfg.frequency.typingEnabled = false
  cfg.memory.enabled = false
  cfg.profile.enabled = false
  cfg.sticker.enabled = false
  cfg.transport.mode = 'onebot'
  saveConfig(cfg)
  Object.assign(S.state, { muted: {}, muteCalls: {}, cooldown: {}, windows: {}, counters: {}, nm: {}, spokeAt: {}, seen: [] })

  const sent = []
  const bot = {
    deriveReplyTarget: () => ({ scope: 'group', targetId: 'G1', msgId: '' }),
    sendText: async (t, b) => sent.push(b),
    sendMarkdown: async () => {},
    sendImage: async () => {},
    sendFile: async () => {},
    sendVideo: async () => {},
  }
  const diagRef = { counts: { markers: 0, redacted: 0 } }
  const bots = []
  const gate = createGate({ getConfig: loadConfig, saveConfig, diagRef, onBot: (bot) => bots.push(bot), logger: silent })

  const inbound = (id, text, sender = 'U1') => ({ __onebot: true, scope: 'group', peer: 'G1', sender, senderName: '小明', content: text, msgId: id })
  const countKind = (kind, origin) => events.readEvents(PK).filter((e) => e.kind === kind && (!origin || e.origin === origin)).length

  A('闸门支持启动时显式绑定 bot', typeof gate.bindBot === 'function')
  gate.bindBot(bot)
  A('启动绑定会交给 onBot', bots.length === 1 && bots[0] === bot, bots)

  const r1 = await gate.onInbound(bot, inbound('m1', '大肥鱼在吗'))
  A('被叫名字 → 放行给模型', r1 === false, r1)
  A('入站不会重复绑定同一个 bot', bots.length === 1, bots)
  A('入站消息落盘', countKind('talk', 'inbound') === 1, events.readEvents(PK))
  A('事件正文脱敏后保存', events.readEvents(PK)[0].text.includes('大肥鱼'))

  await gate.onInbound(bot, inbound('m1', '大肥鱼在吗'))
  A('重复投递不重复记账', countKind('talk', 'inbound') === 1, countKind('talk', 'inbound'))

  await gate.onOutbound(bot, 'sendText', [{ scope: 'group', targetId: 'G1', msgId: '' }, '在的在的'])
  A('她的回复也落盘', countKind('talk', 'bot') === 1, events.readEvents(PK))

  // 策略：off → 不再记账
  policy.setConfirmCode('2468')
  const req = policy.requestChange({ actions: { 'event.record': 'off' } }, { by: 'owner' })
  A('策略变更需要申请', req.ok === true, req)
  const ap = policy.applyChange(req.id, '2468', { by: 'owner' })
  A('确认码正确才生效', ap.ok === true, ap)
  await gate.onInbound(bot, inbound('m2', '大肥鱼再说一句'))
  A('event.record=off → 不记账', countKind('talk', 'inbound') === 1, countKind('talk', 'inbound'))

  // 策略：dryrun → 只记元数据
  const rq2 = policy.requestChange({ actions: { 'event.record': 'dryrun' } }, { by: 'owner' })
  policy.applyChange(rq2.id, '2468', { by: 'owner' })
  await gate.onInbound(bot, inbound('m3', '大肥鱼这句正文别记'))
  const rec3 = events.readEvents(PK).find((e) => e.ref === 'in:m3')
  A('dryrun → 记账但不带正文', rec3 && !rec3.text && rec3.kind === 'talk', rec3)

  // 恢复 auto
  const rq3 = policy.requestChange({ actions: { 'event.record': 'auto' } }, { by: 'owner' })
  policy.applyChange(rq3.id, '2468', { by: 'owner' })

  // 非白名单群：不记账
  const before = countKind('talk', 'inbound')
  await gate.onInbound(bot, { __onebot: true, scope: 'group', peer: 'G-OTHER', sender: 'U9', content: '大肥鱼', msgId: 'm9' })
  A('非白名单群不记账', countKind('talk', 'inbound') === before, countKind('talk', 'inbound'))
}

// ── 3. 隐私旋钮：@昵称脱敏 / 丢链接 / 外链白名单 ──
{
  const cfg = clone(DEFAULTS)
  cfg.privacy.redactNames = true
  const out = privacy.redactText('你好 <@123456> 和 @小明，mail a@b.com', cfg)
  A('redactNames 抹掉 @昵称', out.includes('[@某人]') && !out.includes('@小明') && !out.includes('<@123456>'), out)
  A('邮箱里的 @ 不动（按邮箱规则脱敏）', out.includes('[邮箱]') && !out.includes('[邮箱]某人'), out)

  const on = { privacy: { blockLinks: true } }
  A('blockLinks 丢含链接消息', privacy.shouldDrop('看这个 https://x.com/a', on, 'member').drop === true)
  A('blockLinks 不拦 Owner', privacy.shouldDrop('看这个 https://x.com/a', on, 'owner').drop === false)

  const ht = { privacy: { allowedHosts: ['bilibili.com'] } }
  const f = privacy.filterLinks('好 https://www.bilibili.com/v/1 和 https://evil.cn/x', ht)
  A('allowedHosts 放行白名单主机', f.includes('bilibili.com/v/1'), f)
  A('allowedHosts 隐藏其它链接', f.includes('[外链已隐藏]') && !f.includes('evil.cn'), f)
  A('allowedHosts 空 = 不限制', privacy.filterLinks('https://evil.cn', { privacy: { allowedHosts: [] } }) === 'https://evil.cn')
}

// ── 4. 预算软旋钮：按群/按人取不同上限 ──
{
  const cfg = clone(DEFAULTS)
  cfg.usage.groupDailyTokens = 1000
  cfg.usage.userDailyTokens = 200
  cfg.usage.groupDailyYuan = 9
  cfg.usage.userDailyYuan = 1
  cfg.usage.warnRatio = 0.5
  const g = usage.limitsOf(cfg, 'group')
  const u = usage.limitsOf(cfg, 'c2c')
  A('群预算取群档', g.tokens === 1000 && g.yuan === 9 && g.warnRatio === 0.5, g)
  A('私聊预算取个人档', u.tokens === 200 && u.yuan === 1, u)
  const pb = usage.peerBudget(cfg, 'group', 'G1')
  A('没有用量时预算比例是 0（不误报）', pb && pb.ratio === 0 && pb.warn === false, pb)
  A('关掉两把尺子就不启用', usage.peerBudget({ usage: { groupDailyTokens: 0, groupDailyYuan: 0 } }, 'group', 'G1') === null)
}

// ── 5. 表情单张上限 ──
{
  const cfg = clone(DEFAULTS)
  cfg.sticker.maxPerMsgMB = 1
  const p = join(HOME, 'big-sticker.bin')
  writeFileSync(p, Buffer.alloc(2 * 1024 * 1024))
  let sent = 0
  const bot = { sendImage: async () => { sent += 1 } }
  const r = await sticker.sendSticker(bot, {}, { id: 's1', path: p }, cfg)
  A('超过单张上限不发送', r === false && sent === 0, { r, sent })
  cfg.sticker.maxPerMsgMB = 3
  const r2 = await sticker.sendSticker(bot, {}, { id: 's1', path: p }, cfg)
  A('上限内正常发送', r2 === true && sent === 1, { r2, sent })
}

// ── 6. 新人观察期：前 5 句不建画像 ──
{
  const cfg = clone(DEFAULTS)
  cfg.privacy.newUserObserve = true
  profile.clearGroup('G-OBS')
  const readIdx = () => JSON.parse(readFileSync(join(dirs.profiles, sha('G-OBS', 12), 'index.json'), 'utf8'))
  for (let i = 0; i < 3; i++) profile.record(cfg, 'G-OBS', 'U-NEW', '你好呀', false)
  const m1 = Object.values(readIdx().members)[0]
  A('观察期只计数', m1 && m1.msgs === 3 && !m1.style, m1)
  for (let i = 0; i < 4; i++) profile.record(cfg, 'G-OBS', 'U-NEW', '你好呀你好呀', false)
  const m2 = Object.values(readIdx().members)[0]
  A('过观察期开始建画像', m2 && m2.style && m2.style.msgs >= 1, m2)
}

// ── 输出 ──
console.log('=== P0.5 接线测试 ===')
let fail = 0
for (const [name, pass, detail] of ok) {
  console.log((pass ? 'OK  ' : 'FAIL ') + name + (pass ? '' : '   ' + JSON.stringify(detail)))
  if (!pass) fail++
}
console.log(fail ? `失败 ${fail}` : '全部通过')
try { rmSync(HOME, { recursive: true, force: true }) } catch { /* ignore */ }
process.exitCode = fail ? 1 : 0
