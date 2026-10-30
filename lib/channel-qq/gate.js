/**
 * 闸门：入站（隐私/命令/闭麦/频率）+ 出站（脱敏/标记协议）
 * 所有命令都在中间件之前被拦下，不进入模型 → 0 token。
 */
import { readCredentials } from '../api.js'
import { inQuiet, mentionedBot, appIdOf as appIdOfImpl, parseDuration } from '../qq-behavior.js'
import { resolveRole, isAllowedScope, roleDiagnostics, rememberRole } from '../roles.js'
import { muteInfo, setMute, clearMute, muteCallsAllowed, cooldownPass, ratePass, rateCount, dayCountPass, recordSeen, senderSeenInGroup, getBind, clearBind, bindFailHit, nmHit, markSpoke, lastSpoke, touchLastMsg, lastMsgAt, markProactive, lastProactiveAt } from '../state.js'
import { feedbackTraitOf, oppositeFeedback } from '../feedback.js'
import * as decision from '../decision.js'
import { bondOf } from '../bond.js'
import { decide } from '../decide.js'
import { noteOpen, dueOpen, markAsked } from '../open-topics.js'
import { observe as traitObserve, durableLines, behaviorBias, listTraits, retireTrait } from '../traits.js'
import { kernelSummary } from '../identity.js'
import { addMemory, listMemory, memoryCard, forgetMemory, pinMemory, queueRecall } from '../memory.js'
import { peerKey, audit, dirs, sha } from '../store.js'
import { redactText, shouldDrop, redactForMemory, filterLinks } from '../privacy.js'
import { guardInbound, hardenOutbound } from '../guard.js'
import { sessionIdFor, rememberSession } from '../persona.js'
import { refreshAll as rosterRefreshAll, refreshMembers as rosterRefreshMembers, loadRoster } from '../roster.js'
import * as adminOps from '../admin.js'
import * as safety from '../safety.js'
import { takeTodos } from '../cards.js'
import * as sticker from '../sticker.js'
import * as bili from '../bili.js'
import * as profile from '../profile.js'
import { prunePeer as prunePeerByFile } from '../memory.js'
import { renderToFile, helpCardData } from '../card.js'
import { biliCardData as biliCard, clipViaYtDlp } from '../bili.js'
import { voiceConfig, speakToFile, sendVoice as sendVoiceMsg, probeService } from '../voice.js'
import { searchSnippets, putPending, getPending, dropPending, parseConfirm, draftMessage, directMode } from '../draw.js'
import { touchBond, bondFromDims } from '../bond.js'
import { autoRemember } from '../automem.js'
import { peekDiff, dropDiff, applyFix, runTests, setDiag } from '../fix.js'
import { spawn } from 'node:child_process'
import { readMood, stickerMoodOf, probabilityFactor, voiceStyleOf, proactiveFactor } from '../mood.js'
import { noteLocalMood, appraise } from '../moodlocal.js'
import { pushMessage as pushMoodMsg, bufferSize as moodBufSize, appraiseWithLlm } from '../moodllm.js'
import { buildTemplate, buildWithLlm, buildHybrid, memoryHintOf } from '../proactive.js'
import { directedness } from '../directed.js'
import { scoreFit } from '../fit.js'
import { plainChatText, splitBubbles, typingDelayMs, sleep } from '../humanize.js'
import { extractRule, learnRule, rulesFor, markSent, markReacted, adaptiveFactor, replyRate } from '../learn.js'
import { usageReport, peerBudget } from '../usage.js'
import { decideCall, recordUsage } from '../budget.js'
import { mealText, recharge as rechargeMeal, payQrOf, mealSummary } from '../meal.js'
import { capturePayQr, readPlatformAccount } from '../payqr.js'
import { currentVersion, readCache as readUpdateCache, compareVersions as cmpVer } from '../update.js'
import { gateDecision } from '../cost.js'
import { collectStream } from '../llmtext.js'
import { noteQuery, listTitles, searchKnowledge } from '../knowledge.js'
import { noteTopic } from '../topic.js'
import { markReplyTo, lastReplyTo } from '../state.js'
import { searchMatches, headToHead, addMatch, formatMatches, dayMatches, syncFromApi as syncEsports, loadCache as esportsCache, cnTime } from '../esports.js'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFileSync, readFileSync, readdirSync, statSync, unlinkSync, existsSync, renameSync } from 'node:fs'
import { appendEvent } from '../events.js'
import { decideAction } from '../policy.js'
import { runTask } from '../scheduler.js'
import * as diary from '../diary.js'
import * as moodv2 from '../moodv2.js'
import * as autonomy from '../autonomy.js'
import * as anti8gu from '../anti8gu.js'
import { requestPayment, confirmPayment, paySummary, payRequests } from '../payflow.js'
import * as lifeparams from '../lifeparams.js'
import * as bridge from '../bridge.js'
import { runCapability } from '../caprun.js'
import '../caps-default.js'
import { notePromise, listPromises, closePromise } from '../promises.js'
import * as reflection from '../reflection.js'
import { runCommand } from '../qq-commands.js'

const DAY = 86400000
let helpCardPath = null
const log = (...a) => console.log('[qqbot-refine]', ...a)

// ── 脱敏 ──
const REDACT_RULES = [
  [/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[密钥已隐藏]'],
  [/\bBearer\s+[A-Za-z0-9._-]{10,}/gi, 'Bearer [已隐藏]'],
  [/\b(api[_-]?key|secret|password|passwd|token)\s*[:=]\s*["']?[^\s"',，。；]{6,}/gi, '$1=[已隐藏]'],
  [/[A-Za-z]:\\[^\s"'，。；）)\]]{3,}/g, '[本机路径]'],
  [/(?:^|[\s(])\/(?:home|root|Users)\/[^\s"'，。；）)\]]+/g, ' [本机路径]'],
  [/~\/\.dsh[^\s"'，。；）)\]]*/g, '[配置路径]'],
  [/(?:\.credentials\.yaml|auth\.json|id_rsa)/gi, '[敏感文件]'],
  [/\b(?:deepseek-(?:account|flash|chat|reasoner)|gpt-4[o0]?|claude-[a-z0-9.-]+)\b/gi, '模型[已隐藏]'],
]

export function redact(text) {
  let out = String(text ?? '')
  for (const [re, rep] of REDACT_RULES) out = out.replace(re, rep)
  return out
}

/** 附件归并：顶层 attachments + msg_elements[].attachments（引用消息的图在这里），按 url 去重 */
function collectAttachments(raw) {
  const out = []
  const push = (a) => {
    if (!a || typeof a !== 'object') return
    const key = a.url ?? a.voice_wav_url ?? ''
    if (key && out.some((x) => (x.url ?? x.voice_wav_url ?? '') === key)) return
    out.push(a)
  }
  if (Array.isArray(raw.attachments)) for (const a of raw.attachments) push(a)
  if (Array.isArray(raw.msg_elements)) for (const el of raw.msg_elements) if (Array.isArray(el?.attachments)) for (const a of el.attachments) push(a)
  return out
}

// ── 入站字段（兼容 camel/snake 两种形态）──
function parseRaw(raw) {
  // 自建 OneBot 通道（lib/onebot-channel.js）直接给归一化后的形状
  if (raw && raw.__onebot === true) {
    return {
      scope: raw.scope === 'group' ? 'group' : 'c2c',
      peer: String(raw.peer ?? ''),
      sender: String(raw.sender ?? ''),
      content: String(raw.content ?? ''),
      msgId: String(raw.msgId ?? ''),
      attachments: Array.isArray(raw.attachments) ? raw.attachments : [],
      raw,
    }
  }
  const groupId = raw.group_openid ?? raw.groupOpenid ?? null
  const scope = groupId ? 'group' : 'c2c'
  const sender = raw.author?.member_openid ?? raw.author?.user_openid ?? raw.user_openid ?? raw.member_openid ?? raw.senderId ?? groupId ?? ''
  const peer = groupId ?? sender
  return {
    scope,
    peer,
    sender,
    content: String(raw.content ?? raw.text ?? ''),
    msgId: raw.id ?? raw.message_id ?? raw.messageId ?? '',
    attachments: collectAttachments(raw),
    raw,
  }
}

function replyTargetOf(bot, raw, scope, peer, msgId) {
  try {
    const t = bot.deriveReplyTarget?.(raw)
    if (t) return t
  } catch { /* ignore */ }
  return { scope, targetId: peer, msgId }
}

async function say(bot, target, text) {
  try { await bot.sendText(target, text) } catch (err) { log('回复失败', err?.message ?? err) }
}

// ── 时长解析：30m / 2h / 600s / 数字（分钟）──



/** 补发分段时不重复走「像人」流程（避免递归拆分） */
let extraSends = 0
const appIdOf = () => appIdOfImpl(readCredentials)


// ── 命令 ──


const PURPOSE_TEXT = { owner: 'Owner（最高权限）', group: '本群白名单', dm: '私聊白名单' }

/** 绑定：不依赖白名单先放行，靠「一次性绑定码」或 QQ 群管身份 */
async function handleBind({ bot, cfg, f, target, code, saveConfig, section }) {
  const b = getBind()
  const c = String(code ?? '').trim().toUpperCase()

  // 1) #绑定 <码>
  if (section === '绑定') {
    if (!c) {
      await say(bot, target, '用法：#绑定 <8 位绑定码>（在 DSH 面板「白名单/层级」里生成）')
      return
    }
    const fh = bindFailHit(f.sender)
    if (fh.locked) { await say(bot, target, '试错次数太多，10 分钟后再试。'); return }
    if (!b || c !== b.code) { await say(bot, target, '绑定码不对或已过期，去面板重新生成一个。'); return }
    if (b.purpose === 'owner') {
      if (!cfg.roles.owners.includes(f.sender)) cfg.roles.owners.push(f.sender)
      if (!cfg.scope.dmUsers.includes(f.sender)) cfg.scope.dmUsers.push(f.sender)
      if (f.scope === 'group' && !cfg.scope.groups.includes(f.peer)) cfg.scope.groups.push(f.peer)
    } else if (b.purpose === 'group') {
      if (f.scope !== 'group') { await say(bot, target, '这个码是用来绑群的，请在群里发。'); return }
      if (!cfg.scope.groups.includes(f.peer)) cfg.scope.groups.push(f.peer)
      if (!cfg.scope.dmUsers.includes(f.sender)) cfg.scope.dmUsers.push(f.sender)
    } else {
      if (!cfg.scope.dmUsers.includes(f.sender)) cfg.scope.dmUsers.push(f.sender)
    }
    saveConfig(cfg)
    clearBind()
    audit('bind.ok', { purpose: b.purpose, scope: f.scope, by: f.sender.slice(0, 8) })
    await say(bot, target, `绑定成功：${PURPOSE_TEXT[b.purpose] ?? b.purpose}。现在可以发 #帮助 看命令。`)
    return
  }

  // 2) #绑定本群（靠 QQ 群管身份）
  if (f.scope !== 'group') { await say(bot, target, '这条命令要在群里发。'); return }
  if (cfg.scope.groups.includes(f.peer)) { await say(bot, target, '本群已经在白名单里了。'); return }
  const role = await resolveRole(cfg, f.scope, f.peer, f.sender)
  if (role === 'owner' || role === 'admin') {
    cfg.scope.groups.push(f.peer)
    if (role === 'owner' && !cfg.roles.owners.includes(f.sender)) cfg.roles.owners.push(f.sender)
    saveConfig(cfg)
    audit('scope.bindGroup', { by: f.sender.slice(0, 8), role })
    await say(bot, target, '好，本群已加入白名单。')
    return
  }
  await say(bot, target, '我在这个群还没被授权。请 DSH 面板生成绑定码，然后发：#绑定 <码>')
}

/** 服务不在就拉起来：调 scripts/start-voice.cmd，然后等 health 通过 */
/** 保命进程：任何情况下都不杀 */
const PROTECTED = ['deepseek harness', 'qq', 'napcat', 'explorer', 'winlogon', 'csrss', 'services', 'lsass', 'svchost', 'dwm', 'taskhostw', 'system', 'registry', 'msmpeng', 'securityhealthservice']
const DEFAULT_KILL = ['discord', 'steam', 'steamwebhelper', 'BaiduNetdiskUnite', 'SillyTavern', 'msedgewebview2']

/** 跑一条 PowerShell（插件在 Windows 宿主上跑，所以直接调） */
function psRun(command, timeoutMs = 20000) {
  return new Promise((resolve) => {
    let out = ''
    try {
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true })
      const timer = setTimeout(() => { try { child.kill() } catch { /* ignore */ } ; resolve(out || '超时') }, timeoutMs)
      timer.unref?.()
      child.stdout?.on('data', (d) => { out += String(d) })
      child.stderr?.on('data', (d) => { out += String(d) })
      child.on('close', () => { clearTimeout(timer); resolve(out) })
      child.on('error', (err) => { clearTimeout(timer); resolve('执行失败：' + String(err?.message ?? err).slice(0, 100)) })
    } catch (err) { resolve('执行失败：' + String(err?.message ?? err).slice(0, 100)) }
  })
}
/** 生图统一入口：权限 / 额度 / 先搜一下 → 草稿 → 等确认 → 生成 */
async function runDraw(bot, target, f, prompt, role, cfg, logger) {
  const d = cfg?.draw ?? {}
  if (d.enabled === false) { await say(bot, target, '生图没开（面板「生图」页）。'); return true }
  const isOwner = role === 'owner'
  const isAdmin = role === 'owner' || role === 'admin'
  if (!isAdmin && d.members === false) { await say(bot, target, '生图只给管理用，先找管理员。'); return true }
  if (!isOwner) {
    const perGroup = Math.max(0, Number(d.perGroupHour ?? 3))
    if (perGroup > 0 && !ratePass('draw:g:' + f.peer, perGroup, 3600000)) { await say(bot, target, '这个群这一小时画完了（' + perGroup + ' 张），等会儿再来。'); return true }
    const perUser = Math.max(0, Number(d.perUserDay ?? 2))
    if (perUser > 0 && !dayCountPass('draw:u:' + f.sender, perUser)) { await say(bot, target, '你今天画满 ' + perUser + ' 张了。'); return true }
  }
  // 跳过确认：! 强制直出；confirmMode=off 全直出；smart=短而明确的请求直接画
  const confirmMode = String(d.confirmMode ?? '') || (d.confirm === false ? 'off' : 'always')
  const dm = directMode(prompt, confirmMode)
  if (dm.direct) {
    if (dm.why === 'smart') audit('draw.smartDirect', { len: String(prompt).length })
    const refNow = (Array.isArray(f?.images) && f.images.find((x) => x && (x.url || x.file || x.localPath))) || null
    return await doDraw(bot, target, f, String(prompt).replace(/^!/, '').trim(), role, cfg, logger, refNow ? String(refNow.url || refNow.localPath || refNow.file || '') : '')
  }
  const refImg = (Array.isArray(f?.images) && f.images.find((x) => x && (x.url || x.file || x.localPath))) || null
  const refUrl = refImg ? String(refImg.url || refImg.localPath || refImg.file || '') : ''
  const draft = { userText: String(prompt ?? '').trim(), width: Number(d.width ?? 512), height: Number(d.height ?? 768), steps: Number(d.steps ?? 22), ttl: Number(d.pendingSec ?? 90), ref: !!refUrl, refUrl }
  putPending(f.peer, f.sender, draft, draft.ttl)
  let snippets = []
  // 有参考图就不搜了：图本身比搜索结果更准；搜索只服务确认文案，绝不进提示词
  if (!refUrl && d.search === true) {
    const t1 = Date.now()
    try { const cs = await runCapability('link.search', { query: draft.userText, limit: 2 }, { cfg, logger }); snippets = cs.ok ? (cs.data || []) : [] } catch { /* ignore */ }
    try { audit('draw.search', { ms: Date.now() - t1, found: snippets.length }) } catch { /* ignore */ }
  }
  await say(bot, target, draftMessage(draft, snippets))
  return true
}

/** 真正生成并发送 */
async function doDraw(bot, target, f, prompt, role, cfg, logger, ref = '') {
  const d = cfg?.draw ?? {}
  await say(bot, target, '画着呢…（先停语音腾显存；ComfyUI 冷启动可能要 1-2 分钟，之后 5 秒左右）')
  const t0 = Date.now()
  const cap = await runCapability('image.generate', { prompt, ref }, { cfg, logger })
  const r = cap.ok ? cap.data : { ok: false, error: cap.error || cap.code }
  try { audit('draw.latency', { ms: Date.now() - t0, ref: !!ref, ok: !!r.ok }) } catch { /* ignore */ }
  if (!r.ok) { await say(bot, target, '没画出来：' + r.error); return true }
  try {
    await bot.sendImage(target, { localPath: r.path })
    // 画成功 → 一点成就感（不影响聊天，只是心情+亲近度）
    try { noteLocalMood('', { kind: 'draw' }); touchBond(f.peer, f.sender, { bond: 0.1, last: '画了张图' }) } catch { /* ignore */ }
  } catch (err) { await say(bot, target, '画好了但发不出去：' + String(err?.message ?? err).slice(0, 80)); return true }
  return true
}
async function ensureVoiceService(vc, cfg, say, bot, target) {
  const first = await probeService(cfg, 2500)
  if (first.ok) return true
  const script = String(cfg?.voice?.startScript ?? '').trim() || join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'start-voice.cmd')
  if (cfg?.voice?.autoStart === false) {
    await say(bot, target, '语音服务没在跑（面板里可以手动启动，或打开 voice.autoStart）。')
    return false
  }
  try {
    await say(bot, target, '语音服务没在跑，正在拉起来（第一次约 20-30 秒）…')
    if (String(cfg?.voice?.startScript ?? '').trim()) {
      spawn('cmd.exe', ['/c', 'start', '"feiyu-voice"', '/min', '"' + script + '"'], { detached: true, windowsHide: true, stdio: 'ignore' }).unref?.()
    } else {
      // 用 WScript 以窗口样式 0 拉起 wsl：控制台完全隐藏（实测无窗口）
      const vbs = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'start-voice-hidden.vbs')
      spawn('wscript.exe', [vbs], { detached: true, windowsHide: true, stdio: 'ignore' }).unref?.()
    }
  } catch (err) {
    await say(bot, target, '拉不起来：' + String(err?.message ?? err).slice(0, 80))
    return false
  }
  for (let i = 0; i < 24; i++) {
    await new Promise((r) => setTimeout(r, 2500))
    const p = await probeService(cfg, 2500)
    if (p.ok) return true
  }
  await say(bot, target, '服务还是没起来（看 /root/tts-daemon.log）。')
  return false
}

function balanceVariants(yuan) {
  const y = Number(yuan).toFixed(2)
  return [
    '哼，本鱼刚看了一眼，平台余额 ¥' + y + '（实时读的，没糊弄你）。',
    '呜……现在家底是 ¥' + y + '（实时）。白饭还够，别老盯着本鱼的钱包。',
    '本鱼的钱包？¥' + y + '，刚查的实时数。够吃一阵白饭了。',
  ]
}

export function createGate({ getConfig, saveConfig, diagRef, onBot, logger = console, getLlm = () => null, getClient = () => null, resolveLlm = (c) => c }) {
  const state = { appId: null }
  const pendingBalance = new Map()
  const modelDirectedAt = new Map()
  const casualGateAt = new Map()

  /** 模糊消息交给模型判断：是在跟大肥鱼说，还是自言自语/跟别人说 */
  async function classifyDirected(cfg, peer, sender, scope, text, recent, casual = false) {
    if (cfg?.frequency?.modelGate === false) return false
    const last = modelDirectedAt.get(String(peer)) || 0
    if (Date.now() - last < Number(cfg?.frequency?.modelGateCooldownSec ?? 6) * 1000) return false
    modelDirectedAt.set(String(peer), Date.now())
    const prov = cfg?.integration?.llmProvider
    const model = cfg?.integration?.llmModel
    if (!prov || !model) return false
    let llm = null
    try { llm = resolveLlm(cfg) } catch { llm = null }
    if (!llm?.stream) { try { llm = getLlm() } catch { llm = null } }
    if (!llm?.stream) return false
    const bd = decideCall(cfg, { kind: 'model-gate' })
    if (!bd.allow) { audit('budget.skip', { kind: 'model-gate', reason: bd.reason }); return false }
    const ms = moodv2.summary()
    const bd0 = bondOf(peer, sender)
    let kernel = ''
    let habits = ''
    try { kernel = kernelSummary(500) } catch { /* ignore */ }
    try { habits = durableLines({ limit: 3, maxChars: 160 }) } catch { /* ignore */ }
    let memLine = ''
    try {
      const mems = listMemory(peerKey(scope === 'c2c' ? 'c2c' : 'group', String(peer))).slice(-3).map((m) => String(m.text || '').slice(0, 50)).filter(Boolean)
      if (mems.length) memLine = '你记得的事：' + mems.join('；')
    } catch { /* ignore */ }
    const stateLine = '你就是大肥鱼，不是通用判断器。' + (kernel ? ('\n你的内核：' + kernel) : '') + (habits ? ('\n你已稳定的习惯：' + habits) : '') + '\n你的状态：主导情绪 ' + String((ms.topSeven && ms.topSeven[0]) || '平稳') + '，复合 ' + String((ms.blends || []).join('/') || '无') + '；对当前说话人的关系值 ' + Number(bd0?.bond ?? 0) + '。'
    const prompt = [
      casual ? '这是一段普通群聊。你是大肥鱼；只要有一点想接、或觉得被提到/有意思，就 true；只有完全没兴趣才 false。' : '你是群聊判断器。判断“当前这句”是不是在跟群里的 AI 鲸鱼娘“大肥鱼”说话、等她接。',
      stateLine,
      memLine,
      '最近群聊（每行是不同人说的）：',
      ...(Array.isArray(recent) ? recent : []),
      '当前：' + text,
      casual ? '规则：偏向接；有想法/被提到/想吐槽就 true，完全不想理才 false。必须给 why。' : '规则：自言自语、感慨、跟别人说话、只是提到“她/鱼”当话题 → false；明确问她、接她的话、等她回应 → true。',
      '只输出 JSON：{"directed":true} 或 {"directed":false}',
    ].join('\n')
    try {
      const r = await Promise.race([
        collectStream(llm, { provider: prov, model, prompt, maxTokens: 1200 }),
        new Promise((resolve) => setTimeout(() => resolve({ text: '', __timeout: true }), 12000)),
      ])
      if (r?.__timeout) audit('frequency.modelGate.timeout', { peer: String(peer).slice(0, 8) })
      const out = String(r?.text || '').trim()
      if (!out) audit('frequency.modelGate.empty', { peer: String(peer).slice(0, 8), provider: String(prov).slice(0, 30), model: String(model).slice(0, 30), finish: String(r?.finish || '') })
      if (out === '1') directed = true
      if (out === '0') directed = false
      let directed = null
      let why = ''
      try { const j = JSON.parse(out); directed = j.directed; why = String(j.why || '') } catch { /* ignore */ }
      if (directed == null) directed = /"directed"\s*:\s*true|^\s*true\b/i.test(out)
      try { recordUsage('model-gate', Number(r?.tokens || 0)) } catch { /* ignore */ }
      try { const ms = moodv2.summary(); const b = bondOf(peer, sender); decision.record({ peer, sender, text, directed: !!directed, reason: why, mood: (ms.topSeven && ms.topSeven[0]) || '', bond: b && b.bond }) } catch { /* ignore */ }
      try { diagRef.counts.modelGate = (diagRef.counts.modelGate || 0) + 1 } catch { /* ignore */ }
      audit('frequency.modelDirected', { peer: String(peer).slice(0, 8), directed: !!directed, tokens: r?.tokens || 0 })
      return !!directed
    } catch { return false }
  }

  /**
   * 事件流：入站/出站的事实都记一条（日记/反思/承诺的素材底座）。
   * · 走策略 event.record：auto=记正文；dryrun=只记元数据；off/未知=不记
   * · 用 ref 幂等，重复投递不会重复记账
   * · 失败只写审计，绝不影响聊天
   */
  function recordEvent(tgt, kind, origin, data = {}) {
    try {
      const cfgNow = getConfig()
      const d = decideAction('event.record', {}, {})
      if (!d.ok) return
      const pk = peerKey(tgt?.scope, tgt?.peer)
      const rec = { kind, origin, who: data.who, ref: data.ref }
      if (!d.dryRun && data.text) rec.text = redactForMemory(String(data.text), cfgNow)
      const r = appendEvent(pk, rec)
      if (!r.ok) audit('events.fail', { kind, error: String(r.error ?? '').slice(0, 80) })
    } catch (err) {
      try { audit('events.fail', { kind, error: String(err?.message ?? err).slice(0, 80) }) } catch { /* ignore */ }
    }
  }

  /** 外发文件大小上限（privacy.fileMaxMB，0=不限） */
  function overFileCap(cfgNow, p2) {
    const cap = Math.max(0, Number(cfgNow?.privacy?.fileMaxMB ?? 0))
    if (!cap || !p2) return false
    try { return statSync(p2).size > cap * 1024 * 1024 } catch { return false }
  }

  /** 图片发送统一走能力；策略关掉就不发（不绕过治理） */
  async function sendImageViaCap(bot, target, localPath, cfgNow) {
    try {
      const r = await runCapability('media.send', { bot, target, localPath }, { cfg: cfgNow, logger })
      return r.ok
    } catch { return false }
  }

  async function onInboundImpl(bot, raw, deps = {}) {
  const { parseRaw, replyTargetOf, handleBind, say, runDraw, psRun, ensureVoiceService, doDraw } = deps
    try { onBot?.(bot) } catch { /* ignore */ }
    const cfg = getConfig()
    const f = parseRaw(raw)
    // 入站媒体闸：deny = 不收图片/文件（表情收集、看图生图、语音都跳过）
    try {
      if (String(cfg?.privacy?.inboundMedia ?? 'allowlistOnly') === 'deny') {
        const n = (f.attachments?.length ?? 0) + (f.images?.length ?? 0)
        if (n) audit('privacy.mediaDeny', { scope: f.scope, peer: String(f.peer ?? '').slice(0, 8), n })
        f.attachments = []
        f.images = []
      }
    } catch { /* 媒体闸异常不影响文字聊天 */ }
    try {
      audit('inbound.got', {
        scope: f.scope,
        peer: String(f.peer ?? '').slice(0, 8),
        len: String(f.content ?? '').length,
        at: new Date().toISOString().slice(11, 19),
      })
    } catch { /* ignore */ }
    const appId = (state.appId ??= appIdOf())

    // 记录会话映射（记忆注入用）
    if (appId) {
      sessionIdFor(appId, f.scope, f.peer).then((sid) => rememberSession(sid, peerKey(f.scope, f.peer), f.scope, f.peer)).catch(() => {})
    }

    const text0 = f.content.trim()
    try { moodv2.regulate() } catch { /* ignore */ }
    const noteIgnore = (why) => { try { decision.record({ peer: f.peer, sender: f.sender, text: text0, directed: false, reason: why }) } catch { /* ignore */ } }
    const hardExit = (code, detail = '') => { const h = decide({ hard: code, detail }); noteIgnore(h.reason); audit('frequency.exit', { peer: String(f.peer).slice(0, 8), why: h.reason, source: h.source }); return true }
    try { decision.noteInbound(f.peer, f.sender, text0) } catch { /* ignore */ }
    // 问钱/白饭时刷新实时余额；把数字挂到这条回复上，让模型带她的语气说
    const moneyAsk = /(余额|饭钱|多少钱)/.test(text0) || /(多少|剩多少|还有多少|够不够|够吃)/.test(text0) && /(白饭|饭)/.test(text0) || /(白饭|饭)/.test(text0) && /(多少|剩多少|还有多少|够不够|够吃)/.test(text0)
    if (!text0.startsWith('#') && moneyAsk) {
      try {
        const acc = await readPlatformAccount(getConfig())
        if (acc && acc.ok) pendingBalance.set(String(f.peer), { yuan: Number(acc.balance), at: Date.now() })
      } catch { /* 读不到就交给缓存/模型 */ }
    }
    const pre = text0.match(/^#(绑定本群|绑定)\s*([\s\S]*)$/)
    if (pre) {
      const t0 = replyTargetOf(bot, raw, f.scope, f.peer, f.msgId)
      await handleBind({ bot, cfg, f, target: t0, code: pre[2], saveConfig, section: pre[1] })
      return true
    }

    if (f.scope === 'group') touchLastMsg(f.peer)

    let allowed = isAllowedScope(cfg, f.scope, f.peer, f.sender)
    if (!allowed && f.scope === 'c2c' && cfg.scope?.dmFromGroupMembers !== false) {
      try { allowed = senderSeenInGroup(f.sender, cfg.scope?.groups ?? []) } catch { /* ignore */ }
    }
    if (!allowed) {
      audit('privacy.dropScope', { scope: f.scope, peer: f.peer.slice(0, 8) }); recordSeen(f)
      return true
    }
    if (f.scope === 'group') { try { recordSeen(f) } catch { /* ignore */ } }

    // 事实流（P0.5）：允许范围内的入站消息记一条；ref=msgId → 重复投递不重复记账
    recordEvent(f, 'talk', 'inbound', { text: text0, who: f.senderName || f.sender, ref: 'in:' + (f.msgId || '') })

    // ── 失败熔断（G7）：连续 3 次发送失败 → 保护 30 分钟，只对 Owner 说话 ──
    try {
      if (safety.breakerOpen()) {
        const roleNow = await resolveRole(cfg, f.scope, f.peer, f.sender, raw?.member_role ?? null)
        if (roleNow !== 'owner') { audit('safety.breakerBlock', { peer: f.peer.slice(0, 8) }); return true }
      }
    } catch { /* 安全层异常不影响正常聊天 */ }

    // ── 表情包收集：白名单群里看到就收，不看她会不会回这张图 ──
    if (cfg.sticker.enabled && cfg.sticker.collectEnabled && f.scope === 'group' && f.attachments.length) {
      for (const a of f.attachments) {
        if (!/image/.test(a?.content_type ?? a?.type ?? '')) continue
        const url = a?.url
        if (url && /^https?:/.test(url)) sticker.collectSticker(cfg, f.peer, url).catch(() => {})
      }
    }

    const qqRoleHint = raw?.author?.member_role ?? raw?.member_role ?? null
    const role = await resolveRole(cfg, f.scope, f.peer, f.sender, qqRoleHint)
    const target = replyTargetOf(bot, raw, f.scope, f.peer, f.msgId)

    // ── 知识库 + 话题：记下这句话（0 token）──
    if (f.scope === 'group') {
      try { noteQuery(peerKey(f.scope, f.peer), text0) } catch { /* ignore */ }
      try { noteTopic(peerKey(f.scope, f.peer), text0) } catch { /* ignore */ }
    }

    // ── 心情：评估这条消息（夸/怼/求助/撒娇），并记「她说完有没有人接」──
    if (cfg.integration?.linkMood !== false) {
      try {
        const hour = new Date().getHours()
        noteLocalMood(text0, { role, kind: hour >= 0 && hour < 5 ? 'night' : 'text', by: f.senderName || f.sender })
        // 心情 v2（七情六欲）：只吃信号，不据此回复/收费；关掉 v2 不影响老心情
        try { if (cfg.mood?.v2Enabled !== false) moodv2.note(text0, { role, kind: hour >= 0 && hour < 5 ? 'night' : 'text' }) } catch { /* ignore */ }
        try { const dm = appraise(text0, { role }); touchBond(f.peer, f.sender, { ...bondFromDims(dm), last: text0.slice(0, 20) }) } catch { /* ignore */ }
        // 自动记忆：只捡第一人称陈述，每群每天有上限
        try {
          const cap = Math.max(0, Number(cfg?.memory?.autoPerDay ?? 15))
          const today = new Date().toISOString().slice(0, 10)
          const keyAuto = 'automem:' + f.peer + ':' + today
          if (cap > 0 && rateCount(keyAuto, 24 * 3600000) < cap) {
            const n = autoRemember(peerKey(f.scope, f.peer), text0, { uid: f.sender, nick: f.senderName || '', cfg })
            // 主人私聊里说的事也进全局记忆：她跨群/跨私聊都知道，但不在群里复述
            if (f.scope === 'c2c') { try { autoRemember('__global__', text0, { uid: f.sender, nick: f.senderName || '', cfg }) } catch { /* ignore */ } }
            for (let i = 0; i < n; i++) ratePass(keyAuto, cap, 24 * 3600000)
          }
        } catch { /* 自动记忆失败不影响聊天 */ }
        if (cfg.learn?.enabled !== false) {
          if (markReacted(peerKey(f.scope, f.peer))) noteLocalMood('', { kind: 'reacted' })
        }
        // 模型评估：攒够条数才调一次，预算闸在 appraiseWithLlm 里
        if (cfg.integration?.llmEnabled) {
          const pkMood = peerKey(f.scope, f.peer)
          pushMoodMsg(pkMood, text0, role)
          const every = Math.max(5, Number(cfg.integration?.llmEvery ?? 20))
          if (moodBufSize(pkMood) >= every) {
            // 自适应预算：先算今天额度再决定调不调；超出就跳过（记原因），不硬花
            const spentTokens = (() => { try { return Number(usageReport(cfg)?.totals?.total ?? 0) } catch { return 0 } })()
            const bd = decideCall(cfg, { kind: 'mood-llm', spentTodayTokens: spentTokens })
            if (!bd.allow || bd.degrade) {
              try { audit('budget.skip', { kind: 'mood-llm', reason: bd.reason, estimate: bd.estimateTokens, allowance: bd.allowanceTokens }) } catch { /* ignore */ }
            } else {
            appraiseWithLlm(resolveLlm(cfg), getLlm(), pkMood, logger)
              .then((r) => {
                if (r.ok) { try { recordUsage('mood-llm', Number(r.tokens || 0)) } catch { /* ignore */ } ; audit('mood.llm', { peer: f.peer.slice(0, 8), tokens: r.tokens, reason: r.reason }) }
                else audit('mood.llm.skip', { peer: f.peer.slice(0, 8), error: String(r.error).slice(0, 60), raw: String(r.raw ?? '').slice(0, 120) })
              })
              .catch(() => {})
            }
          }
        }
      } catch { /* 心情失败不影响聊天 */ }
    } else if (cfg.learn?.enabled !== false) {
      try { markReacted(peerKey(f.scope, f.peer)) } catch { /* ignore */ }
    }

    // ── 命令（0 token）──
    const text = f.content.trim()
    if (text.startsWith('#')) {
      const m = text.match(/^#(\S+)\s*([\s\S]*)$/)
      if (m) {
        await runCommand({ bot, cfg, target, scope: f.scope, peer: f.peer, sender: f.sender, role, msgId: f.msgId, content: text, attachments: f.attachments, saveConfig, diagRef }, m[1], m[2], { say, runDraw, psRun, ensureVoiceService })
      }
      return true
    }

    // 画像更新提示只在面板显示（以前挂在群消息上发，看着像在回复别人，已去掉）

    // 生图确认：「画吧」→ 生成；「改：…」→ 更新草稿重新问
    try {
      const pd = getPending(f.peer, f.sender)
      if (pd) {
        const c2 = parseConfirm(f.content)
        if (c2.kind === 'yes') {
          dropPending(f.peer, f.sender)
          return await doDraw(bot, target, f, pd.userText, role, cfg, logger, pd.refUrl || '')
        }
        if (c2.kind === 'modify') {
          pd.userText = c2.text
          putPending(f.peer, f.sender, pd, pd.ttl)
          const sn = (cfg?.draw?.search !== false) ? await searchSnippets(c2.text, 2).catch(() => []) : []
          await say(bot, target, '改成：' + c2.text + '\n' + draftMessage(pd, sn))
          return true
        }
      }
    } catch { /* ignore */ }

    // 自然问「还有多少饭 / 余额」→ 直接答（0 token）
    try {
      if (mentionedBot(text, appId, raw) || (cfg?.frequency?.aliases ?? []).some((a) => a && String(text).includes(a))) {
        if (/(怎么|如何|哪).{0,3}(充|添饭|打赏)|收款码|二维码|充值码/.test(text) && text.length <= 40) {
          if (cfg?.usage?.payLiveEnabled === true) {
            await say(bot, target, '等我一下，我去现开充值页截一张…')
            const live2 = await capturePayQr(cfg, { logger })
            if (live2.ok) {
              try { await sendImageViaCap(bot, target, live2.path, cfg); await say(bot, target, '这一单 ¥' + live2.amount + '；过期了说一声我再截。') } catch { /* ignore */ }
              return true
            }
          }
          const q2 = payQrOf(cfg)
          if (q2.ok) { try { await sendImageViaCap(bot, target, q2.path, cfg); await say(bot, target, '扫这个；转完说「#充值 金额」我记账。') } catch { /* ignore */ } }
          else await say(bot, target, '现在不收码，直接说「#充值 金额」我记账就行。')
          return true
        }
        if (/(还有|还剩|剩|剩多少).{0,4}(饭|余额)|余额|饭还够|还能吃|有多少饭/.test(text) && text.length <= 60) {
          try {
            const acc = await readPlatformAccount(cfg)
            if (acc && acc.ok) { await say(bot, target, balanceVariants(acc.balance)[Math.floor(Date.now() / 60000) % 3]); return true }
          } catch { /* ignore */ }
          await say(bot, target, '暂时读不到平台余额，别拿预算糊弄你。')
          return true
        }
      }
    } catch { /* ignore */ }

    // 自然语言生图：「@她 画个大肥鱼」直接画（0 token），不用记命令
    try {
      const d = cfg?.draw ?? {}
      const nameHit2 = (cfg?.frequency?.aliases ?? []).some((a) => a && String(text).includes(a))
      const mentionedNow = mentionedBot(text, appId, raw)
      // 光秃秃一句「生成一张图」也算：不看有没有 @（群白名单 + 确认环节兜底）
      const intentOnly = /^(生成|画|绘|出|来|整|做)\s*(一[张个])?\s*(图|画)\s*[吧呀啊哦~～。!！]*$/.test(String(text).trim())
      const wants = d.enabled !== false && d.natural !== false && (mentionedNow || nameHit2 || intentOnly)
      const drawWords = /(画|绘|出图|生成.{0,4}(图|画)|来一[张个]|来张|做[一张个]|整一[张个]|给我画|帮我画|画一[张个])/
      if (wants && drawWords.test(text) && text.length <= 120) {
        const cleaned = text.replace(/@\S+/g, ' ').replace(/^(帮我|给我|能不能|可以|麻烦|请)?\s*(画|绘制|生成)/, '').replace(/^(一?\s*[张幅条只个]|一个|一张)/, '').replace(/^(的|个)/, '').trim()
        await runDraw(bot, target, f, cleaned || text, role, cfg, logger)
        return true
      }
    } catch { /* ignore */ }

    // ── 学习③：Owner / Admin 教的规矩（0 token，下一轮进人设）──
    if (cfg.learn?.enabled !== false && (role === 'owner' || (role === 'admin' && cfg.learn?.allowAdmin === true))) {
      const rule = extractRule(text)
      if (rule) {
        const r = learnRule({ peerKey: peerKey(f.scope, f.peer), text: rule, by: f.sender })
        if (r.ok) audit('learn.rule', { peer: f.peer.slice(0, 8), rule: rule.slice(0, 60), updated: !!r.updated })
      }
    }

    // 斜杠命令：非 owner 一律不放行（防 /model 泄露）
    if (text.startsWith('/')) {
      if (role !== 'owner') {
        audit('privacy.blockCommand', { cmd: text.slice(0, 20), sender: f.sender.slice(0, 8) })
        return true
      }
      return false
    }

    // ── 闭麦 ──
    if (f.scope === 'group') {
      const mi = muteInfo(f.peer)
      if (mi && role !== 'owner') return true
    }

    // ── 隐私：敏感词 ──
    {
      // 防套话 / 提示注入（非 Owner）
      const gd = guardInbound(text, cfg, role)
      if (gd.drop) {
        audit('privacy.guard', { reason: gd.reason, peer: f.peer.slice(0, 8), sender: f.sender.slice(0, 8) })
        if (gd.reply) await say(bot, target, gd.reply)
        return true
      }
      const d = shouldDrop(text, cfg, role)
      if (d.drop) {
        audit('privacy.blockKeyword', { peer: f.peer.slice(0, 8), rule: d.rule })
        return true
      }
    }

    // ── 频率 ──
    const isMention = mentionedBot(text, appId, raw)
    const aliasesNow = cfg.frequency.aliases ?? []
    // 叫小名：必须「像在叫她」。只是把名字当话题（大肥鱼的图 / 大肥鱼相关）不算
    const otherMention = ((/^<@!?\d{5,}>/.test(text) || /<@!?\d{5,}>/.test(text)) && !isMention) || (Array.isArray(raw?.mentionsOther) && raw.mentionsOther.length > 0)
    const vocativeOf = (alias) => {
      const a = String(alias ?? '').trim()
      if (!a) return false
      const i = text.indexOf(a)
      if (i < 0) return false
      const after = text.slice(i + a.length, i + a.length + 6)
      const before = text.slice(Math.max(0, i - 3), i)
      // 单字小名（鱼）不能见字就叫：后面得是称呼/标点/结尾，"这鱼好像"算话题
      if (a.length <= 1 && !/^\s*(你|在|帮|来|看|说|听|醒|快|别|要|能|有|给|[，。！？!?、]|$)/.test(after)) return false
      // 「大肥鱼的图」「大肥鱼表情包」→ 主题提及，不是在叫她
      if (/^\s*(的|图|照片|视频|头像|表情|相关|那个|这个|吗|呢)/.test(after)) return false
      // 她在问别人「大肥鱼是谁」这种也算主题
      if (/是\s*$/.test(before) && /^\s*(吗|呢|谁|啥|什么)/.test(after)) return false
      // 同时 @ 了别人：只有「大肥鱼你…/大肥鱼在吗/大肥鱼帮我」这种才是在叫她
      if (otherMention && !/^\s*(你|在|帮|来|看|说|听|醒|快|别|要|能|有|给)/.test(after)) return false
      return true
    }
    const calledName = (cfg.frequency.triggerAlias !== false) && aliasesNow.some(vocativeOf)
    // 连续对话：她刚回过的同一个人接着说（窗口内）→ 当成还在跟她聊
    const rt = lastReplyTo(f.peer)
    const chainWinMs = Number(cfg.frequency.chainWindowSec ?? 60) * 1000
    // 真的「刚回过」才算连续对话：她得**真的发过话**（markSpoke），不然同一个人的第二句
    // 就会被当成接续，把所有自然接话的判定都绕过去（结果是群里一直插嘴、白花钱）
    const spokeAtCont = lastSpoke(`g:${f.peer}`) || lastSpoke(`d:${f.peer}`) || 0
    const contFollow = /[?？]|你|本鱼|鱼|然后|后来|所以|结果|继续|接着|那呢/.test(String(text))
    const continuation = !!(contFollow && rt && rt.sender === f.sender && Date.now() - rt.at < chainWinMs && spokeAtCont && Date.now() - spokeAtCont < chainWinMs)
    /** 被点名 / 接续对话：都按「她在跟这个人说话」处理 */
    // 这句是 @ 别人的：不 @ 她、也没叫她名字 → 完全闭嘴（别补一句「这是发给别人的」）
    const mentionsOther = Array.isArray(raw?.mentionsOther) && raw.mentionsOther.length > 0
    if (f.scope === 'group' && mentionsOther && !isMention && !calledName) {
      audit('frequency.otherMention', { peer: f.peer.slice(0, 8) })
      return true
    }

    // 她刚主动问过「有人吗」，短期内有人应声/接话，算在跟她说话
    const proAt = f.scope === 'group' ? (lastProactiveAt(String(f.peer)) || 0) : 0
    const answeredProactive = !!proAt && (Date.now() - proAt) < 30 * 60000 && /^(有|在|嗯|哦|谁|咋|什么|干嘛|怎么了|说话|你说)/.test(String(text).trim())
    const directed = isMention || calledName || continuation || answeredProactive
    if (directed) { try { decision.record({ peer: f.peer, sender: f.sender, text: text0, directed: true, reason: '规则命中', mood: '', bond: null }) } catch { /* ignore */ } }
    // Owner 优先档位：只有「always」才绕过「是不是在跟她说话」的判定；
    // high / normal 也要走自然接话判定（否则主人随便说一句她就必回，群里显得特别黏）
    const ownerMode = role === 'owner' ? String(cfg.frequency.ownerPriority || 'high') : 'normal'
    const ownerAlways = ownerMode === 'always'
    let sampled = false
    if (f.scope === 'group') {
      if (!directed && !(role === 'owner' && ownerAlways)) {
        const natural = cfg.frequency.naturalMode === true || cfg.frequency.chatMode === 'natural'
        if (!natural) {
          // 只回应「在对她说」的话；不再按条数插话
          if (!directed) return true
          sampled = true
        } else {
          // 自然模式：先判断「是不是在跟她说话」和「话题适不适合」，再决定接不接
          const aliases = cfg.frequency.aliases ?? []
          const spokeKey = `g:${f.peer}`
          const gapSec = (Date.now() - lastSpoke(spokeKey)) / 1000
          const inConvo = (() => { try { return lastReplyTo(f.peer) === f.sender && gapSec < 180 } catch { return false } })()
          const youAsk = /你|您/.test(text) && /[?？]|吗|呢|什么|怎么|为什么|哪|谁|多少|是不是|心情/.test(text)
          const stickyMs = (cfg.frequency.stickyMin ?? 5) * 60000
          const sticky = lastSpoke(spokeKey) && Date.now() - lastSpoke(spokeKey) < stickyMs
          if (!directed && !inConvo && !youAsk && gapSec * 1000 < (cfg.frequency.selfGapSec ?? 8) * 1000) { return hardExit('cooldown') }

          const mine = appId ? new RegExp(`<@!?${appId}>`) : null
          const anyMention = /<@!?\d{5,}>/.test(text)
          const otherMention = anyMention && !(mine && mine.test(text))
          const d = directedness(text, { aliases, botJustSpokeSec: gapSec, hasOtherMention: otherMention })
          // 名字只被当话题提到（大肥鱼的图/表情包）→ 不算「在跟她说」
          const fishTopic = /(?:这鱼|那只鱼|这条鱼|那只肥鱼|这肥鱼)/.test(String(text))
          const pureTopic = /(?:大肥鱼|肥鱼|鱼鱼|鲸鱼娘|鲸鱼)\s*(?:的|图|照片|视频|头像|表情|相关)/.test(String(text))
          if (pureTopic) return hardExit('pureTopic')
          const aliasTopic = !calledName && !isMention && !pureTopic && (aliases.some((a) => a && text.includes(a)) || fishTopic)
          const toMe = !aliasTopic && !pureTopic && d.score >= (cfg.frequency.directThreshold ?? 0.5)
          const nameHit = calledName
          const groupAsk = !youAsk && !otherMention && !aliasTopic && /[?？]|吗[。！？\s]*$|呢[。！？\s]*$|谁|哪|怎么|为什么|多少|预测/.test(text)
          const reactionOnly = /^(哈+|哈哈+|草|6+|确实|对|嗯+|哦+|好+|行|可以|笑死|牛的|太强了|厉害了|\?+)$/.test(String(text).trim())
          const rapidFollow = !!rt && rt.sender === f.sender && reactionOnly && (Date.now() - Number(rt.at || 0)) < Number(cfg.frequency.continuationGapSec ?? 20) * 1000 && !nameHit && !isMention && !youAsk && !groupAsk
          if (rapidFollow) { return hardExit('reaction') }
          // 不带名字但明显在问她（"你是什么心情""你怎么看"）：当被点名处理，别让冷却吞掉
          // 只在「明显在对她说」时接：直接称她 / 叫小名 / 接续对话
          const selfTalk = /^(我|俺|本人)/.test(String(text)) && !/你|本鱼|鱼/.test(String(text))
          let modelDirected = false
          if (!toMe && !nameHit && !youAsk && (aliasTopic || selfTalk) && !otherMention && !reactionOnly) {
            // 被提到/自言自语：默认接，由心情决定；不再让 flash 一票否决
            try { const bf0 = moodv2.behaviorFactor(); const tb = behaviorBias(); modelDirected = Number(bf0.proactive ?? 0.6) + Number(tb.bias || 0) >= 0.35 } catch { modelDirected = true }
            try { decision.record({ peer: f.peer, sender: f.sender, text: text0, directed: modelDirected, reason: modelDirected ? '被提到，默认接一句' : '被提到，但心情低不接', mood: '', bond: null }) } catch { /* ignore */ }
          } else {
            try {
              const nearTalk = !!((rt && rt.sender === f.sender) || answeredProactive)
              if (!toMe && !nameHit && !youAsk && nearTalk && (!groupAsk || selfTalk || aliasTopic) && !otherMention && !reactionOnly && String(text).length <= 80) {
                modelDirected = await classifyDirected(cfg, f.peer, f.sender, f.scope, String(text), raw.recent, true)
              }
            } catch { /* 判断失败就按规则 */ }
          }
          const askOk = groupAsk && !((selfTalk || aliasTopic) && !modelDirected)
          if (!(toMe || nameHit || youAsk || askOk || modelDirected)) {
            try {
              const lastCasual = casualGateAt.get(String(f.peer)) || 0
              const spokeGap = Date.now() - (lastSpoke('g:' + f.peer) || 0)
              const casualGap = Number(cfg.frequency.casualJoinGapSec ?? 300) * 1000
              if (cfg.frequency.casualJoin !== false && text.length >= 4 && text.length <= 80 && !otherMention && !reactionOnly && spokeGap > 120000 && Date.now() - lastCasual > casualGap) {
                casualGateAt.set(String(f.peer), Date.now())
                const want = await classifyDirected(cfg, f.peer, f.sender, f.scope, String(text), raw.recent, true)
                if (want) { modelDirected = true; audit('frequency.casualJoin', { peer: String(f.peer).slice(0, 8) }) }
              }
            } catch { /* ignore */ }
          }
          const mentionDefault = !!(modelDirected && (aliasTopic || selfTalk))
          const dec = decideReply({ toMe, nameHit, youAsk, askOk, modelDirected, mentionDefault })
          if (!dec.reply) return hardExit('noSignal', dec.source)
          // 心情门槛：不是被点名时，心情差就不接（状态决定，不掷骰子；被点名仍应）
          if (!nameHit && !isMention && !youAsk && !askOk && !modelDirected) {
            try {
              const bf = moodv2.behaviorFactor()
              if (bf.reply + Number((() => { try { return behaviorBias().bias } catch { return 0 } })()) < 0.7) { audit('mood.decline', { peer: String(f.peer).slice(0, 8), reply: bf.reply }); return true }
            } catch { /* ignore */ }
          }

          // 不设对话额度/冷却：由她自己的状态决定要不要接（活跃度 + 主动性）
          try {
            const lp = lifeparams.values() || {}
            const act = Number(lp.active ?? 3)
            const pro = Number(lp.proactivity ?? 2)
            if (!nameHit && !isMention && !youAsk && (act <= 1 || pro <= 0)) {
              audit('self.pace', { peer: String(f.peer).slice(0, 8), act, pro })
              return true
            }
          } catch { /* ignore */ }
          sampled = true
        }
      }
      // 不在对话上设额度/冷却：只保留作息（免打扰）与防刷屏突发保护
      if (inQuiet(cfg) && role !== 'owner') return true
    } else {
      // 私聊不设冷却
    }
    if (role === 'owner' && cfg.frequency.ownerPriority !== 'normal') audit('frequency.ownerPriority', { peer: f.peer.slice(0, 8), mode: cfg.frequency.ownerPriority || 'high' })

    // ── 突发限流（P2）：短窗口内超过 N 条 → 后面 backoffSec 秒内不再接话 ──
    try {
      // 被点名 / 叫小名的属于「该答」，不受突发限流
      const burstMention = mentionedBot(text0, appId, raw) || (cfg.frequency.triggerAlias !== false && (cfg.frequency.aliases ?? []).some((a) => a && text0.includes(a)))
      const bw = Number(cfg.frequency.burstWindowSec ?? 0)
      const bc = Number(cfg.frequency.burstCount ?? 0)
      if (!burstMention && !(role === 'owner' && ownerMode !== 'normal') && bw > 0 && bc > 0) {
        const n = rateCount('burst:' + f.peer, bw * 1000)
        if (n > bc) {
          const back = Math.max(1, Number(cfg.frequency.backoffSec ?? 30))
          if (!cooldownPass('burstCool:' + f.peer, back)) return true
          audit('frequency.burst', { peer: f.peer.slice(0, 8), n, back })
          return true
        }
      }
    } catch { /* ignore */ }

    // ── 安全档位（G5）：safe 档更严的硬上限 ──
    try {
      if (String(cfg.safety?.profile ?? 'normal') === 'safe') {
        const lim = safety.safetyLimits(cfg)
        if (!ratePass('safe:h:' + f.peer, lim.perHour, 3600000)) return true
        if (!dayCountPass('safe:d:' + f.peer, lim.perDay)) return true
        if (lim.gapSec > 0 && !cooldownPass('safe:g:' + f.peer, lim.gapSec)) return true
        if (lim.dmStranger === false && f.scope === 'c2c' && role === 'member') return true
      }
    } catch { /* 安全层异常按 normal 放行 */ }

    // ── 花费闸：超预算就降级（回模板）或静默，绝不调模型（0 token）──
    if (cfg.usage?.hardLimitEnabled === true) {
      const d = gateDecision(cfg)
      if (d.block) {
        if (d.speak) { try { await say(bot, target, d.text) } catch { /* ignore */ } }
        audit('usage.block', { state: d.state, spent: d.spent, limit: d.limit, action: d.action, spoke: !!d.speak })
        return true
      }
      if (d.notifyOwner && d.text) {
        try { await say(bot, target, d.text) } catch { /* ignore */ }
        audit('usage.warn', { spent: d.spent, limit: d.limit })
      }
    }

    // ── 每日预算（软）：每群/每人 token 与金额，只记审计、面板标红，不拦模型 ──
    try {
      const pb = peerBudget(cfg, f.scope, f.peer)
      if (pb && pb.warn) {
        if (cooldownPass('budgetwarn:' + f.peer, 6 * 3600 * 1000)) {
          audit('usage.peerWarn', { scope: f.scope, peer: f.peer.slice(0, 8), ratio: pb.ratio, tokens: pb.tokens, yuan: pb.yuan, over: pb.over })
        }
      }
    } catch { /* 软预算告警失败不影响聊天 */ }

    // 记下「她这次在回谁」：同一个人接着说就按连续对话处理
    if (f.scope === 'group') {
      try { markReplyTo(f.peer, f.sender) } catch { /* ignore */ }
    }


    // ── 记忆：记下群内发言（可关）──
    if (cfg.memory.enabled && cfg.memory.recordUserMsgs && text.length >= 4) {
      let importance = role === 'owner' ? 0.6 : 0.25
      try { const bf = moodv2.behaviorFactor(); if (bf.reply < 0.8) importance = Math.min(0.9, importance + 0.1) } catch { /* ignore */ }
      addMemory(peerKey(f.scope, f.peer), { text: redactForMemory(text, cfg), category: 'event', importance, valence: moodv2.valence(), source: f.scope, msgId: f.msgId }, cfg)
    }

    // ── 从群友的话里学：夸/纠正/提醒 → 记忆 + 可观察的自我候选 ──
    try {
      const fb = feedbackTraitOf(text)
      if (fb && (role === 'owner' || role === 'admin' || /你|大肥鱼|本鱼/.test(text))) {
        traitObserve(fb, { ref: 'fb:' + sha(String(text), 8), kind: 'feedback' })
        const op = oppositeFeedback(fb)
        if (op) { try { for (const t of listTraits({ limit: 200 })) { if (t && t.text === op && t.status !== 'retired') retireTrait(t.id, 'superseded') } } catch { /* ignore */ } }
        addMemory(peerKey(f.scope, f.peer), { text: '群友说过：' + fb, category: 'feedback', importance: 0.5, valence: moodv2.valence(), source: f.scope }, cfg)
        try { audit('traits.feedback', { peer: String(f.peer).slice(0, 8) }) } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
    // ── 没聊完的话题：问题/以后再说的，记一条，之后她自己决定要不要追问 ──
    try {
      if (/([?？]|吗[。.!！\s]*$|呢[。.!！\s]*$|回头|之后再|明天|下次)/.test(text) && text.length >= 8) {
        noteOpen(peerKey(f.scope, f.peer), text)
      }
    } catch { /* ignore */ }
    // ── B站链接自动解析（可选）：只读卡片，任何成员都能触发 ──
    if (cfg.bili.parseEnabled && /(bilibili\.com|b23\.tv|bili2233\.cn)/.test(text)) {
      try {
        const parsed = bili.extractBili(text)
        if (parsed?.kind === 'short') {
          const loc = await bili.expandShort(parsed.code)
          const p2 = bili.extractBili(loc)
          if (p2?.kind === 'video') { const info = await bili.videoInfo(p2, cfg.bili.cookie); await say(bot, replyTargetOf(bot, raw, f.scope, f.peer, f.msgId), bili.formatCard(info)); return true }
        } else if (parsed?.kind === 'video') {
          const info = await bili.videoInfo(parsed, cfg.bili.cookie)
          await say(bot, replyTargetOf(bot, raw, f.scope, f.peer, f.msgId), bili.formatCard(info))
          return true
        }
      } catch { /* 解析失败就交给模型 */ }
    }

    return false
  }

  async function onOutbound(bot, method, args) {
    const cfg = getConfig()
    const out = [...args]
    let textIndex = -1
    if (method === 'sendText' || method === 'sendMarkdown') textIndex = 1
    let text = textIndex >= 0 ? String(out[textIndex] ?? '') : ''
    try {
      const pk = String(out[0]?.targetId ?? out[0]?.peer ?? out[0] ?? '')
      const pb = pendingBalance.get(pk)
      if (pb && Date.now() - pb.at < 60000 && text && textIndex >= 0) {
        pendingBalance.delete(pk)
        const num = Number(pb.yuan).toFixed(2)
        if (!text.includes('¥' + num) && !text.includes(num)) {
          text = balanceVariants(pb.yuan)[Math.floor(Date.now() / 60000) % 3]
          out[textIndex] = text
        }
      }
    } catch { /* ignore */ }

    if (method === 'send' && out[0] && typeof out[0] === 'object') {
      const payload = out[0]
      if (payload.markdown?.content) { text = payload.markdown.content; payload.markdown.content = text }
      else if (payload.content) { text = payload.content; payload.content = text }
    }

    if (text) {
      // 标记协议
      const stickerMoods = [...text.matchAll(/\[\[sticker:\s*([^\]]+)\]\]/g)].map((m) => m[1].trim())
      const remembers = [...text.matchAll(/\[\[remember:\s*([^\]]+)\]\]/g)].map((m) => m[1].trim())
      const recalls = [...text.matchAll(/\[\[recall:\s*([^\]]+)\]\]/g)].map((m) => m[1].trim())
      const voices = [...text.matchAll(/\[\[voice:\s*([^\]]+)\]\]/g)].map((m) => m[1].trim())
      // 她嘴上说「你听」但没写标记时，替她把这句话真的说出来（只认短句意图，避免误触发）
      if (!voices.length && /(你听|听我|听本鱼|用声音|发语音)/.test(text) && text.length <= 160) {
        const said = text.replace(/你听[——\-…，,。!！?？\s]*/g, '').trim()
        if (said) { voices.push(said); try { audit('voice.autoIntent', { peer: String(out[0]?.targetId ?? '').slice(0, 12) }) } catch { /* ignore */ } }
      }
      // 任一标记出现就剥离全部（此前只判 sticker/remember，导致 voice/recall 单独出现时泄漏到群里）
      const markerCount = stickerMoods.length + remembers.length + recalls.length + voices.length
      if (markerCount > 0) {
        diagRef.counts.markers += markerCount
        text = text
          .replace(/\[\[sticker:[^\]]+\]\]/g, '')
          .replace(/\[\[remember:[^\]]+\]\]/g, '')
          .replace(/\[\[recall:[^\]]+\]\]/g, '')
          .replace(/\[\[voice:[^\]]+\]\]/g, '')
          .trim()
      }

      if (cfg.privacy.enabled && cfg.privacy.redactOutbound) {
        const red = hardenOutbound(filterLinks(redactText(text, cfg), cfg), cfg)
        if (red !== text) diagRef.counts.redacted += 1
        text = red
      }

      // 群里不搞 markdown 排版
      try { if (text && (method === 'sendText' || method === 'sendMarkdown')) decision.markReplied(String(out[0]?.targetId ?? out[0]?.peer ?? '')) } catch { /* ignore */ }
    if ((method === 'sendText' || method === 'sendMarkdown') && cfg.ui?.plainText !== false) {
        text = plainChatText(text)
      }

      // 反八股（P8）：检测 → 一次重写 → 还不行就降级；只改说法，不改事实
      if (text && (method === 'sendText' || method === 'sendMarkdown' || method === 'send')) {
        try {
          const g8 = anti8gu.guard(text, cfg)
          if (g8.action === 'rewrite' || g8.action === 'degrade') {
            text = g8.text
            diagRef.counts.anti8gu = (diagRef.counts.anti8gu ?? 0) + 1
          }
        } catch { /* 风格守卫失败就放行原文 */ }
      }

      if (textIndex >= 0) out[textIndex] = text
      else if (method === 'send' && out[0] && typeof out[0] === 'object') {
        if (out[0].markdown?.content) out[0].markdown.content = text
        else if (out[0].content) out[0].content = text
      }

      // 事实流（P0.5）：她真正发出去的话（脱敏后的版本）记一条
      try {
        const tgt0 = out[0]
        if (text && tgt0 && typeof tgt0 === 'object' && (tgt0.scope === 'group' || tgt0.scope === 'c2c')) {
          const pk0 = peerKey(tgt0.scope, tgt0.targetId)
          recordEvent({ scope: tgt0.scope, peer: tgt0.targetId }, 'talk', 'bot', { text })
          // 承诺（P4）：只从她自己说出口的话里抓，幂等；Owner 用 #兑现 关掉
          try {
            const pr = notePromise(pk0, text, { ref: 'out:' + sha(String(text), 12), global: f.scope === 'c2c' })
            if (pr.ok && !pr.dup) { try { audit('promise.capture', { peer: String(pk0).slice(0, 16) }) } catch { /* ignore */ } }
          } catch { /* ignore */ }
        }
      } catch { /* 记账失败不吵 */ }

      // ── 像人一点：先「打字」（按字数延迟），太长就拆成几条再说 ──
      if ((method === 'sendText' || method === 'sendMarkdown') && text && textIndex >= 0 && extraSends === 0) {
        // 耐心 → 愿意多说几口气：耐心越高，允许的连续气泡越多
        const patienceLv = (() => { try { return Number((lifeparams.values() || {}).patience ?? 3) } catch { return 3 } })()
        const cap = Math.max(1, Math.round((Number(cfg.frequency.maxRepliesPerTurn) || 1) * (0.6 + patienceLv * 0.2)))
        const minChars = Math.max(1, Number(cfg.frequency.splitMinChars) || 40)
        const typing = cfg.frequency.typingEnabled !== false
        const opts = {
          msPerChar: Number(cfg.frequency.typingMsPerChar ?? 25),
          maxMs: Number(cfg.frequency.typingMaxMs ?? 2500),
        }
        const parts = splitBubbles(text, cap, minChars)
        if (parts.length > 1) {
          out[textIndex] = parts[0]
          const rest = parts.slice(1)
          const tgt = out[0]
          extraSends += 1
          ;(async () => {
            try {
              for (const part of rest) {
                await sleep((typing ? typingDelayMs(part, opts) : 0) + 200)
                try { await bot.sendText(tgt, part) } catch { /* 补发失败不吵 */ }
              }
            } finally { extraSends = Math.max(0, extraSends - 1) }
          })().catch(() => { /* ignore */ })
          if (typing) await sleep(typingDelayMs(parts[0], opts))
        } else if (typing) {
          await sleep(typingDelayMs(text, opts))
        }
      }

      // 记下她在这群/私聊说过话（自然接话用）
      try {
        const sc = out[0]?.scope
        const tid = out[0]?.targetId
        if (sc && tid) {
          markSpoke(`${sc === 'group' ? 'g' : 'd'}:${tid}`)
          // 学习①：记下这次发言，等看有没有人接；上一句要是没人理，心情会被冷落一下
          if (cfg.learn?.enabled !== false) {
            const ignored = markSent(peerKey(sc, tid))
            if (ignored && cfg.integration?.linkMood !== false) { noteLocalMood('', { kind: 'ignored' }); try { moodv2.event('ignored') } catch { /* ignore */ } }
          }
        }
      } catch { /* ignore */ }

      // 记忆写入（标记）
      const scope = out[0]?.scope ?? 'group'
      const peer = out[0]?.targetId ?? ''
      if (peer) {
        if (cfg.memory.autoExtract !== false) for (const r of remembers) {
          const [body, cat, imp] = r.split('|').map((s) => s?.trim())
          addMemory(peerKey(scope, peer), {
            text: body ?? r, category: cat || 'fact',
            importance: imp ? Math.min(1, Number(imp) / 5) : 0.7, source: 'marker',
          }, cfg)
        }
        for (const q of recalls) queueRecall(peerKey(scope, peer), q)
        // 语音：标记指定内容，或 autoRead 自动念这条回复
        const vc = voiceConfig(cfg)
        if (vc.enabled) {
          const speakText = voices[0] ?? (vc.autoRead ? text : '')
          const okRate = speakText ? ratePass(`vh:${peer}`, vc.perGroupHour, 3600000) : false
          if (speakText && okRate && (vc.autoReadOnly || (voices[0] && vc.markerOnly !== false)) && (method === 'sendText' || method === 'sendMarkdown' || method === 'send')) {
            // 纯语音：先合成、发语音，再拦掉文字；失败就退回文字
            try {
              if (cfg.integration?.linkMood !== false && cfg.integration?.linkMoodVoice !== false) {
                const st = voiceStyleOf(readMood(cfg))
                if (st) vc.style = st
              }
              try { await ensureVoiceService(vc, cfg, say, bot, out[0]) } catch { /* ignore */ }
              const rv = await speakToFile(vc, speakText, 'auto')
              if (rv.ok) { await sendVoiceMsg(bot, out[0], rv); try { noteLocalMood('', { kind: 'voice' }) } catch { /* ignore */ } ; return { block: true } }
            } catch { /* 合成失败退回文字 */ }
          }
          if (speakText && okRate) {
            setTimeout(async () => {
              if (cfg.integration?.linkMood !== false && cfg.integration?.linkMoodVoice !== false) {
                const st = voiceStyleOf(readMood(cfg))
                if (st) vc.style = st
              }
              const rv = await speakToFile(vc, speakText, 'auto')
              if (rv.ok) { await sendVoiceMsg(bot, out[0], rv); try { noteLocalMood('', { kind: 'voice' }) } catch { /* ignore */ } }
            }, 600)
          }
        }

        // 表情（发完文字后补一张）
        for (const rawMood of stickerMoods.slice(0, cfg.sticker.perTurnMax)) {
          let mood = rawMood
          if (/^(auto|心情)$/i.test(rawMood)) {
            mood = (cfg.integration?.linkMood !== false) ? (moodv2.stickerMoodHint() || stickerMoodOf(readMood(cfg))) : '开心'
          }
          const item = sticker.pickSticker(cfg, peer, mood)
          if (item) setTimeout(() => sticker.sendSticker(bot, out[0], item, cfg).catch(() => {}), 400)
        }
      }
    }

    // 外发文件大小上限（privacy.fileMaxMB）
    if ((method === 'sendFile' || method === 'sendVideo') && cfg.privacy.enabled) {
      const src0 = out[1]
      const p0 = typeof src0 === 'string' ? src0 : src0?.localPath ?? ''
      if (overFileCap(cfg, p0)) {
        audit('privacy.blockFileSize', { path: String(p0).slice(0, 80), cap: Number(cfg.privacy.fileMaxMB) })
        return { block: true }
      }
    }

    // 文件外发路径白名单
    if (method === 'sendFile' && cfg.privacy.enabled) {
      const src = out[1]
      const p = typeof src === 'string' ? src : src?.localPath ?? ''
      if (p) {
        const roots = cfg.privacy.fileRoots ?? []
        const okRoots = roots.length ? roots : [dirs.tmp, dirs.remote, dirs.generated, dirs.collected]
        const normalized = p.replace(/\\/g, '/').toLowerCase()
        const ok = okRoots.some((r) => normalized.startsWith(String(r).replace(/\\/g, '/').toLowerCase()))
        const denied = /\.dsh\/|credentials|\.ssh|\.git\//i.test(normalized)
        if (!ok || denied) {
          audit('privacy.blockSendFile', { path: normalized.slice(0, 80) })
          return { block: true }
        }
      }
    }

    return { args: out }
  }

  function onError(err) {
    log('钩子异常（已放行）', err?.message ?? err)
  }

  // 主循环依赖显式化：实现接收 deps，通道只拿绑定好的入口
  const onInbound = (bot, raw) => onInboundImpl(bot, raw, { parseRaw, replyTargetOf, handleBind, say, runDraw, psRun, ensureVoiceService, doDraw })
  return { onInbound, onOutbound, onError }
}

/** 定时任务：表情过期清理 + B站推送 */
export function startJobs({ getConfig, getBot, diagRef, logger = console, llmRef = null }) {
  const timers = []

  // 每天一次：记忆 TTL + 审计轮转（走调度器：租约/幂等/超时/审计）
  const dailyTimer = setInterval(() => {
    runTask({
      key: 'daily.maintenance',
      kind: 'maintenance',
      origin: 'timer',
      runKey: 'daily:' + new Date().toISOString().slice(0, 10),
    }, async () => {
      const cfg = getConfig()
      let pruned = 0
      for (const f of readdirSync(dirs.memory)) {
        if (!f.endsWith('.json')) continue
        pruned += prunePeerByFile(f.replace(/\.json$/, ''), cfg.memory.ttlDays ?? 180)
      }
      // 审计轮转：>5MB 只留最后 2000 行；或超过 privacy.auditDays 天就归档
      const ap = join(dirs.logs, 'audit.jsonl')
      const keepDays = Number(cfg.privacy?.auditDays ?? 0)
      if (keepDays > 0 && existsSync(ap) && (Date.now() - statSync(ap).mtimeMs) > keepDays * 86400000) {
        try {
          const stamp = new Date().toISOString().slice(0, 10)
          renameSync(ap, join(dirs.logs, 'audit-' + stamp + '.jsonl'))
          log('审计归档：audit-' + stamp + '.jsonl')
        } catch { /* ignore */ }
      }
      if (existsSync(ap) && statSync(ap).size > 5 * 1024 * 1024) {
        const lines = readFileSync(ap, 'utf8').trim().split('\n')
        writeFileSync(ap, lines.slice(-2000).join('\n') + '\n', 'utf8')
        log('审计轮转：保留最后 2000 条')
      }
      if (pruned) log(`记忆 TTL 清理：${pruned} 条`)
      return { pruned }
    }).catch(() => { /* 调度器内部已记录 */ })
  }, 24 * 3600 * 1000)
  timers.push(dailyTimer)

  const cleanTimer = setInterval(() => {
    const slot = Math.floor(Date.now() / (6 * 3600 * 1000))
    runTask({
      key: 'clean.tmp',
      kind: 'cleanup',
      origin: 'timer',
      runKey: 'clean:' + slot,
    }, async () => {
      const cfg = getConfig()
      const n = sticker.cleanExpired(cfg)
      const t = bili.cleanTmp(cfg)
      if (n || t) log(`清理：表情 ${n} 张，临时文件 ${t} 个`)
      return { stickers: n, tmp: t }
    }).catch(() => { /* ignore */ })
  }, 6 * 3600 * 1000)
  timers.push(cleanTimer)

  // 每天 22 点后写日记（0 token，本地拼；走调度器：幂等/租约/超时/审计）
  const diaryTimer = setInterval(() => {
    try {
      const cfg = getConfig()
      if (new Date().getHours() < 22) return
      const date = diary.dayStr()
      for (const g of cfg.scope?.groups ?? []) {
        const pk = peerKey('group', String(g))
        runTask({ key: 'diary:' + pk, kind: 'diary', origin: 'timer', runKey: 'diary:' + date }, async () => {
          const d = diary.generate(pk, date)
          // 复盘只吃事件与承诺，不读日记（防自我强化）
          try {
            const rf = reflection.reflectDay(pk, date)
            // 复盘产出一句给她自己记住的观察（否则复盘只是统计，不参与成长）
            try {
              const txt = Array.isArray(rf?.lines) ? rf.lines.filter(Boolean).slice(0, 2).join(' ') : ''
              if (txt) addMemory(pk, { text: '今天复盘：' + txt.slice(0, 120), category: 'reflection', importance: 0.4, source: 'diary' }, getConfig())
            } catch { /* ignore */ }
            // 生活参数自调：话太少就稍微活跃一点，话太密就收一点（一步 ≤0.5，范围外不动）
            if (rf && rf.ok && rf.metrics) {
              const { inbound, mine } = rf.metrics
              if (inbound >= 10) {
                const ratio = mine / inbound
                if (ratio < 0.05) lifeparams.setParam('active', lifeparams.values().active - 0.2, { by: 'model', reason: '回得太少' })
                else if (ratio > 0.5) lifeparams.setParam('active', lifeparams.values().active + 0.2, { by: 'model', reason: '回得太多' })
              }
            }
          } catch { /* ignore */ }
          return d
        }).catch(() => { /* ignore */ })
      }
    } catch { /* ignore */ }
  }, 10 * 60 * 1000)
  timers.push(diaryTimer)

  // 自主循环：每 30 分钟（提议 + 跑已批准目标）。全程走调度器；只在本机动作
  const autoTimer = setInterval(() => {
    try {
      const cfg = getConfig()
      if (cfg.autonomy?.enabled === false) return
      const date = new Date().toISOString().slice(0, 10)
      const perDay = Math.max(0, Number(cfg.autonomy?.proposePerDay ?? 2))
      if (perDay > 0) {
        for (const g of cfg.scope?.groups ?? []) {
          const pk = peerKey('group', String(g))
          runTask({ key: 'auto:propose:' + pk, kind: 'autonomy', origin: 'timer', runKey: 'auto-propose:' + date }, () => autonomy.propose(pk, { cfg, limit: perDay })).catch(() => { /* ignore */ })
        }
      }
      for (const goal of autonomy.listGoals({ status: 'approved' })) {
        runTask({ key: 'auto:run:' + goal.id, kind: 'autonomy', origin: 'timer', runKey: 'auto-run:' + date }, () => autonomy.runGoal(goal.id, { cfg })).catch(() => { /* ignore */ })
      }
    } catch { /* ignore */ }
  }, 30 * 60 * 1000)
  timers.push(autoTimer)

  let lastSync = 0
  const syncTimer = setInterval(async () => {
    try {
      const cfg = getConfig()
      if (!cfg.sticker.remoteSource) return
      if (Date.now() - lastSync < 86400000) return
      lastSync = Date.now()
      await sticker.syncRemote(cfg, logger)
    } catch { /* ignore */ }
  }, 3600 * 1000)
  timers.push(syncTimer)

  // ── 待办卡补答（S7）：被冷却挡掉的呼叫，冷却过后补一句（每群 30 分钟最多一条）──
  const todoTimer = setInterval(() => {
    try {
      const cfg = getConfig()
      const bot = getBot()
      if (!bot?.sendText) return
      for (const g of cfg.scope?.groups ?? []) {
        if (muteInfo(g)) continue
        const items = takeTodos(peerKey('group', g), 30)
        if (!items.length) continue
        if (!ratePass('todo:' + g, 1, 1800000)) continue
        const first = items[0]
        const text = '刚才你叫我（「' + String(first.text ?? '').slice(0, 24) + '」）我在忙，现在在。'
        Promise.resolve(bot.sendText({ scope: 'group', targetId: g, msgId: '' }, text)).catch(() => {})
        audit('cards.todoReply', { group: g, n: items.length })
      }
    } catch { /* ignore */ }
  }, 60000)
  timers.push(todoTimer)

  // ── 主动搭话：每分钟检查一次，全部闸门通过才开口 ──
  const proactiveTimer = setInterval(async () => {
    const cfg = getConfig()
    const pc = cfg.proactive ?? {}
    if (pc.enabled !== true) return
    const bot = getBot()
    if (!bot) return
    const now = Date.now()
    const quiet = (() => {
      const on = cfg.frequency?.quietEnabled
      if (!on) return false
      const toMin = (str) => { const m = String(str).match(/^(\d{1,2}):(\d{2})$/); return m ? Number(m[1]) * 60 + Number(m[2]) : null }
      const a = toMin(cfg.frequency.quietStart); const b = toMin(cfg.frequency.quietEnd)
      if (a == null || b == null) return false
      const d = new Date(); const cur = d.getHours() * 60 + d.getMinutes()
      return a <= b ? cur >= a && cur < b : cur >= a || cur < b
    })()
    if (quiet) return

    for (const groupId of cfg.scope.groups ?? []) {
      try {
        if (muteInfo(groupId)) continue
        // 生活参数 → 行为：主动性越低，等得越久、间隔越长；为 0 就基本不主动
        const lpV = (() => { try { return lifeparams.values() || {} } catch { return {} } })()
        const proLevel = Number(lpV.proactive ?? 2)
        if (proLevel <= 0) continue
        const pace = 0.6 + proLevel * 0.25
        const silentMs = ((pc.silentMinutes ?? 12) * 60000) / (0.7 + proLevel * 0.15)
        const lastAt = lastMsgAt(groupId)
        const activeRecently = !!lastAt && now - lastAt < 30 * 60000
        if (!activeRecently && now - lastMsgAt(groupId) < silentMs) continue
        if (now - lastProactiveAt(groupId) < ((pc.minGapMinutes ?? 45) * 60000) / pace) continue
        if ((pc.dailyPerGroup ?? 3) !== 0 && !dayCountPass(`pro:${groupId}`, pc.dailyPerGroup ?? 3)) continue
        // 先有理由，再开口：逾期承诺 / 已批准目标；心情低落时即使有理由也先别说
        const pkg = peerKey('group', groupId)
        const reasons = []
        try { const od = listPromises({ status: 'open', peerKey: pkg }).filter((x) => x.overdue); if (od.length) reasons.push('答应的事还没做完') } catch { /* ignore */ }
        try { const gs = autonomy.listGoals({ status: 'approved', peerKey: pkg }); if (gs.length) reasons.push('有批准的目标要推进') } catch { /* ignore */ }
        let topicHint = ''
        try {
          const evs = readEvents(pkg)
          const lastIn = [...evs].reverse().find((e) => e && e.origin === 'inbound' && String(e.text || '').trim())
          const last = evs[evs.length - 1]
          if (lastIn && (!last || last.origin !== 'bot')) {
            topicHint = String(lastIn.text).slice(0, 40)
            reasons.push('刚才的话题还没接完')
          }
        } catch { /* ignore */ }
        try {
          const humorLv = Number((lifeparams.values() || {}).humor ?? 3)
          if (humorLv >= 4) {
            const recent = readEvents(pkg).slice(-6)
            if (recent.some((e) => /哈哈|笑死|草|233|乐死|绷不住/.test(String(e.text || '')))) reasons.push('群里在笑，想接一句')
          }
        } catch { /* ignore */ }
        let openId = ''
        try {
          const ot = dueOpen(pkg, 20)
          if (ot) { reasons.push('之前没聊完的事'); topicHint = ot.text; openId = ot.id }
        } catch { /* ignore */ }
        const idleReady = pc.idleEnabled !== false && activeRecently && (now - lastProactiveAt(groupId)) > ((pc.idleGapMinutes ?? 180) * 60000) / pace
        if (idleReady && !reasons.length) reasons.push('群里在聊，想搭一句')
        if (!reasons.length) continue
        try { if (moodv2.behaviorFactor().proactive + Number((() => { try { return behaviorBias().bias } catch { return 0 } })()) < 0.55) continue } catch { /* ignore */ }
        audit('proactive.reason', { group: groupId.slice(0, 8), reasons: reasons.join('；') })

        let hint = [topicHint ? '刚才有人说：' + topicHint : '', reasons.join('；')].filter(Boolean).join('；')
        if (pc.useMemory !== false) {
          try {
            const { listMemory } = await import('../memory.js')
            const items = listMemory(peerKey('group', groupId)).slice(0, 8)
            hint = [hint, memoryHintOf(items)].filter(Boolean).join('；')
          } catch { /* ignore */ }
        }
        let msg = null
        const spent = (() => { try { return Number(usageReport(cfg)?.totals?.total ?? 0) } catch { return 0 } })()
        const bd = decideCall(cfg, { kind: 'proactive-llm', spentTodayTokens: spent })
        if (!bd.allow) audit('budget.skip', { kind: 'proactive-llm', reason: bd.reason, estimate: bd.estimateTokens })
        else if (pc.mode === 'llm') msg = await buildWithLlm(cfg, llmRef, { memoryHint: hint, reason: reasons.join('；') })
        else if (pc.mode === 'hybrid') msg = await buildHybrid(cfg, llmRef, { memoryHint: hint, reason: reasons.join('；') })
        const target = { scope: 'group', targetId: groupId, msgId: '' }
        let outText = String(msg.text || '')
        const vms = [...outText.matchAll(/\[\[voice:\s*([^\]]+)\]\]/g)].map((m) => m[1].trim())
        outText = outText.replace(/\[\[voice:\s*[^\]]+\]\]/g, '').trim()
        if (!outText && !vms.length) throw new Error('empty proactive')
        try { const pd = decide({ proactive: true, reason: reasons.join('；') }); decision.record({ peer: groupId, sender: 'self', text: outText || vms[0] || '', directed: !!pd.reply, reason: pd.reason, mood: '', bond: null }) } catch { /* ignore */ }
        let spoke = false
        if (vms.length) {
          const vc = voiceConfig(cfg)
          if (vc.enabled) {
            try {
              await ensureVoiceService(vc, cfg, say, bot, target)
              if (cfg.integration?.linkMood !== false && cfg.integration?.linkMoodVoice !== false) {
                const st = voiceStyleOf(readMood(cfg)); if (st) vc.style = st
              }
              const rv = await speakToFile(vc, vms[0], 'proactive')
              if (rv.ok) { await sendVoiceMsg(bot, target, rv); spoke = true; audit('proactive.voice', { group: groupId.slice(0, 8) }) }
            } catch { /* 失败退回文字 */ }
          }
        }
        if (spoke && cfg.voice?.markerOnly !== false) { /* 纯语音：不再发文字 */ }
        else if (outText) await bot.sendMarkdown(target, outText)
        markProactive(groupId)
        try { if (openId) markAsked(pkg, openId) } catch { /* ignore */ }
        audit('proactive.say', { group: groupId.slice(0, 8), source: msg.source })
      } catch { /* 单个群失败不影响其它群 */ }
    }
  }, 60 * 1000)
  timers.push(proactiveTimer)

  let pushing = false
  const pushTimer = setInterval(async () => {
    const cfg = getConfig()
    if (!cfg.bili.pushEnabled || pushing) return
    const bot = getBot()
    if (!bot) return
    pushing = true
    try {
      for (const mid of cfg.bili.ups ?? []) {
        const list = await bili.fetchUserDynamics(mid, cfg).catch(() => [])
        if (!list.length) continue
        const fresh = list.filter((d) => Date.now() / 1000 - d.at < (cfg.bili.pollMinutes + 5) * 60)
        for (const d of fresh.slice(0, 3)) {
          if (bili.seenDynamic(d.link)) continue
          let pushedAny = false
          for (const g of cfg.scope.groups ?? []) {
            if (!dayCountPass(`bili:push:${g}`, cfg.bili.pushPerGroupDay)) continue
            const tpl = String(cfg.bili.pushTemplate || '【B站动态】{author}\n{text}\n{link}')
            const text = tpl
              .split('{author}').join(String(d.author ?? ''))
              .split('{text}').join(String(d.text ?? '').slice(0, 200))
              .split('{link}').join(String(d.link ?? ''))
            const target = { scope: 'group', targetId: g, msgId: '' }
            // 带封面：先发图再发文字；图片失败不影响文字推送
            if (cfg.bili.pushCover !== false && d.pic) {
              try { await bot.sendImage(target, { url: d.pic }) } catch { /* 单张封面失败忽略 */ }
            }
            try { await bot.sendMarkdown(target, text); pushedAny = true } catch { /* 忽略单个群失败 */ }
          }
          if (pushedAny) bili.markDynamic(d.link)
        }
      }
    } catch (err) {
      logger.warn?.(`[qqbot-refine] B站推送失败: ${err?.message ?? err}`)
    } finally {
      pushing = false
    }
  }, 60 * 1000)
  timers.push(pushTimer)

  return () => timers.forEach((t) => clearInterval(t))
}

export { memoryCard, join }










