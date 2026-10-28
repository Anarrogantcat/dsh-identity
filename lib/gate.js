/**
 * 闸门：入站（隐私/命令/闭麦/频率）+ 出站（脱敏/标记协议）
 * 所有命令都在中间件之前被拦下，不进入模型 → 0 token。
 */
import { readCredentials } from './api.js'
import { resolveRole, isAllowedScope, roleDiagnostics, rememberRole } from './roles.js'
import { muteInfo, setMute, clearMute, muteCallsAllowed, cooldownPass, ratePass, rateCount, dayCountPass, recordSeen, getBind, clearBind, bindFailHit, nmHit, markSpoke, lastSpoke, touchLastMsg, lastMsgAt, markProactive, lastProactiveAt } from './state.js'
import { addMemory, listMemory, memoryCard, forgetMemory, pinMemory, queueRecall } from './memory.js'
import { peerKey, audit, dirs, sha } from './store.js'
import { redactText, shouldDrop, redactForMemory, filterLinks } from './privacy.js'
import { guardInbound, hardenOutbound } from './guard.js'
import { sessionIdFor, rememberSession } from './persona.js'
import { refreshAll as rosterRefreshAll, refreshMembers as rosterRefreshMembers, loadRoster } from './roster.js'
import * as adminOps from './admin.js'
import * as safety from './safety.js'
import { takeTodos } from './cards.js'
import * as sticker from './sticker.js'
import * as bili from './bili.js'
import * as profile from './profile.js'
import { prunePeer as prunePeerByFile } from './memory.js'
import { renderToFile, helpCardData } from './card.js'
import { biliCardData as biliCard, clipViaYtDlp } from './bili.js'
import { voiceConfig, speakToFile, sendVoice as sendVoiceMsg, probeService } from './voice.js'
import { searchSnippets, putPending, getPending, dropPending, parseConfirm, draftMessage, directMode } from './draw.js'
import { touchBond, bondFromDims } from './bond.js'
import { autoRemember } from './automem.js'
import { peekDiff, dropDiff, applyFix, runTests, setDiag } from './fix.js'
import { spawn } from 'node:child_process'
import { readMood, stickerMoodOf, probabilityFactor, voiceStyleOf, proactiveFactor } from './mood.js'
import { noteLocalMood, appraise } from './moodlocal.js'
import { pushMessage as pushMoodMsg, bufferSize as moodBufSize, appraiseWithLlm } from './moodllm.js'
import { buildTemplate, buildWithLlm, buildHybrid, memoryHintOf } from './proactive.js'
import { directedness } from './directed.js'
import { scoreFit } from './fit.js'
import { plainChatText, splitBubbles, typingDelayMs, sleep } from './humanize.js'
import { extractRule, learnRule, rulesFor, markSent, markReacted, adaptiveFactor, replyRate } from './learn.js'
import { usageReport, peerBudget } from './usage.js'
import { mealText, recharge as rechargeMeal, payQrOf, mealSummary } from './meal.js'
import { capturePayQr } from './payqr.js'
import { currentVersion, readCache as readUpdateCache, compareVersions as cmpVer } from './update.js'
import { gateDecision } from './cost.js'
import { noteQuery, listTitles, searchKnowledge } from './knowledge.js'
import { noteTopic } from './topic.js'
import { markReplyTo, lastReplyTo } from './state.js'
import { searchMatches, headToHead, addMatch, formatMatches, dayMatches, syncFromApi as syncEsports, loadCache as esportsCache, cnTime } from './esports.js'
import { join } from 'node:path'
import { writeFileSync, readFileSync, readdirSync, statSync, unlinkSync, existsSync, renameSync } from 'node:fs'
import { appendEvent } from './events.js'
import { decideAction } from './policy.js'
import { runTask } from './scheduler.js'
import * as diary from './diary.js'
import * as moodv2 from './moodv2.js'
import * as autonomy from './autonomy.js'
import * as anti8gu from './anti8gu.js'
import { requestPayment, confirmPayment, paySummary, payRequests } from './payflow.js'
import * as lifeparams from './lifeparams.js'
import * as bridge from './bridge.js'
import { runCapability } from './caprun.js'
import './caps-default.js'
import { notePromise, listPromises, closePromise } from './promises.js'
import * as reflection from './reflection.js'

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
function parseDuration(input, defSec) {
  if (!input) return defSec
  const m = String(input).match(/^(\d+(?:\.\d+)?)\s*(s|m|h|秒|分钟|分|小时|时)?$/)
  if (!m) return defSec
  const n = Number(m[1])
  const unit = m[2] ?? 'm'
  if (unit === 's' || unit === '秒') return Math.round(n)
  if (unit === 'h' || unit === '小时' || unit === '时') return Math.round(n * 3600)
  return Math.round(n * 60)
}

// ── 免打扰 ──
function inQuiet(cfg, now = new Date()) {
  if (!cfg.frequency.quietEnabled) return false
  const toMin = (s) => {
    const m = String(s).match(/^(\d{1,2}):(\d{2})$/)
    return m ? Number(m[1]) * 60 + Number(m[2]) : null
  }
  const a = toMin(cfg.frequency.quietStart)
  const b = toMin(cfg.frequency.quietEnd)
  if (a == null || b == null) return false
  const cur = now.getHours() * 60 + now.getMinutes()
  return a <= b ? cur >= a && cur < b : cur >= a || cur < b
}

let cachedAppId = null
/** 补发分段时不重复走「像人」流程（避免递归拆分） */
let extraSends = 0
function appIdOf() {
  if (cachedAppId) return cachedAppId
  try { cachedAppId = readCredentials()?.appId ?? null } catch { cachedAppId = null }
  return cachedAppId
}

function mentionedBot(content, appId, raw) {
  // ① 事件的 mentions[] 最可靠：全量模式下 @谁都是 <@member_openid>，只看文本认不出是不是机器人
  try {
    const ms = raw && raw.mentions
    if (Array.isArray(ms) && ms.length) {
      if (ms.some((m) => m && (m.bot === true || m.is_bot === true))) return true
      if (appId && ms.some((m) => String((m && m.id) || '').includes(String(appId)))) return true
    }
  } catch { /* ignore */ }
  // ② 旧格式：@机器人是 <@!appId>
  if (appId && new RegExp('<@!?' + appId + '>').test(content)) return true
  return false
}

// ── 命令 ──
async function runCommand(ctxObj, cmd, argStr) {
  const { bot, cfg, target, scope, peer, sender, role, msgId, content } = ctxObj
  const isAdmin = role === 'owner' || role === 'admin'
  const groupId = scope === 'group' ? peer : null
  const pk = peerKey(scope, peer)

  switch (cmd) {
    case '帮助': case 'help': {
      if (cfg.ui?.helpCard !== false) {
        try {
          if (!helpCardPath || !existsSync(helpCardPath)) helpCardPath = await renderToFile(helpCardData(), 'help-card')
          const p = helpCardPath
          if (p) { await bot.sendImage(target, { localPath: p }); return true }
        } catch { /* 回落文本 */ }
      }
      await say(bot, target, '#帮助 的卡片没发出来（大概是画图依赖缺失）。常用：#绑定本群 #群状态 #闭嘴 30m #说话 #记得 内容 #人设 #表情 无语 #B站 <链接> #用量')
      return true
    }

    case '版本': case 'version': {
      if (!isAdmin) return true
      const cur = currentVersion()
      const c = readUpdateCache()
      const latest = c?.ok ? String(c.latest ?? '') : ''
      const has = latest && cmpVer(latest, cur) > 0
      const when = c?.checkedAt ? new Date(c.checkedAt).toLocaleString('zh-CN') : ''
      await say(bot, target, has
        ? ('当前 v' + cur + '，最新 v' + latest + (when ? '（' + when + ' 查的）' : '') + '。面板右上点「更新到 v' + latest + '」，完事重启 DSH。')
        : (latest ? ('当前 v' + cur + '，已经是最新（' + when + ' 查的）。') : ('当前 v' + cur + '，还没查过最新版；面板右上点「检查更新」。')))
      return true
    }

    case '绑定本群':
      if (role !== 'owner' && role !== 'admin') { await say(bot, target, '只有群主/管理员或 Owner 能绑定本群。'); return true }
      if (scope !== 'group') { await say(bot, target, '这条命令要在群里发。'); return true }
      if (!cfg.scope.groups.includes(peer)) {
        cfg.scope.groups.push(peer)
        ctxObj.saveConfig(cfg)
        audit('scope.bindGroup', { peer, by: sender })
        await say(bot, target, '好，本群已加入白名单。')
      } else {
        await say(bot, target, '本群已经在白名单里了。')
      }
      return true

    case '群状态': {
      if (!isAdmin) return true
      const mi = groupId ? muteInfo(groupId) : null
      const q = inQuiet(cfg) ? '是' : '否'
      await say(bot, target, [
        `闭麦：${mi ? `还有 ${Math.ceil(mi.remainMs / 60000)} 分钟（by ${mi.by.slice(0, 8)}）` : '无'}`,
        `免打扰时段：${cfg.frequency.quietEnabled ? `${cfg.frequency.quietStart}-${cfg.frequency.quietEnd}` : '关'}（当前${q}在时段内）`,
        `QQ 权限：${groupId ? (roleDiagnostics(groupId).admins.length ? `已识别 ${roleDiagnostics(groupId).admins.length} 位群管/群主` : '尚未识别到群管（接口可能无权限）') : '私聊'}`,
      ].join('\n'))
      return true
    }

    case '群列表': case 'grouplist': {
      if (!isAdmin) return true
      const client = getClient()
      if (!client?.connected) { await say(bot, target, '当前不是 onebot 通道（或还没连上 NapCat），拿不到群列表。'); return true }
      const rr = await rosterRefreshAll(client, cfg)
      if (!rr.ok) { await say(bot, target, '拉取失败：' + rr.error); return true }
      const groups = loadRoster().groups.slice(0, 30)
      await say(bot, target, [
        '我看到的群（' + rr.groups + ' 个）：',
        ...groups.map((g) => '· ' + (g.name || '(无名)') + '｜' + g.id + '｜' + g.count + '人'),
      ].join('\n'))
      return true
    }

    case '群成员': case 'groupmembers': {
      if (!isAdmin) return true
      if (!groupId) { await say(bot, target, '这条命令要在群里发。'); return true }
      const client = getClient()
      if (!client?.connected) { await say(bot, target, '当前不是 onebot 通道（或还没连上 NapCat），拿不到成员列表。'); return true }
      const rm = await rosterRefreshMembers(client, groupId, cfg)
      if (!rm.ok) { await say(bot, target, '拉取失败：' + rm.error); return true }
      const list = loadRoster().members[String(groupId)]?.list ?? []
      const owners = list.filter((m) => m.role === 'owner')
      const admins = list.filter((m) => m.role === 'admin')
      const show = owners.concat(admins).slice(0, 12)
      await say(bot, target, [
        '本群 ' + rm.count + ' 人（群主 ' + owners.length + ' / 管理 ' + admins.length + '）',
        ...show.map((m) => '· ' + (m.card || m.nickname) + '(' + m.id + ') ' + (m.role === 'owner' ? '群主' : '管理')),
        show.length < owners.length + admins.length ? '…' : '',
      ].filter(Boolean).join('\n'))
      return true
    }

    case '闭嘴': {
      if (!isAdmin) return true
      if (!groupId) { await say(bot, target, '闭麦只能在群里用。'); return true }
      if (!muteCallsAllowed(groupId, cfg.order.mutePerHour)) { await say(bot, target, '这个群这一小时闭麦次数用完了。'); return true }
      const sec = Math.min(parseDuration(argStr, cfg.order.muteDefaultSec), cfg.order.muteMaxSec)
      setMute(groupId, sec * 1000, sender, argStr || '')
      audit('order.mute', { group: groupId, sec, by: sender })
      await say(bot, target, String(cfg.order.muteTemplate ?? '好，{n} 分钟内我不说话。（#说话 可解除）').replace('{n}', String(Math.round(sec / 60))))
      return true
    }

    case '充值码': {
      // ① 实时码：现开 DeepSeek 充值页，截「当次一单」的二维码
      if (cfg?.usage?.payLiveEnabled === true) {
        await say(bot, target, '等我一下，我去现开充值页截一张（十几秒）…')
        const live = await capturePayQr(cfg, { logger: ctxObj.logger ?? console })
        if (live.ok) {
          const tip = live.full ? '没定位到二维码，先发整页截图，你截里面那块码。' : ('这一单 ¥' + live.amount + (live.expiry ? '，' + live.expiry : '') + '。过期了说一声我再截。')
          try { await bot.sendImage(target, { localPath: live.path }); await say(bot, target, tip + ' 付完说「#充值 金额」我记账。') } catch (err) { await say(bot, target, '截到了但发不出去：' + String(err?.message ?? err).slice(0, 60)) }
          return true
        }
        await say(bot, target, '实时码没截出来：' + live.error + '。我先发之前那张静态收款码。')
      }
      // ② 静态收款码
      const q = payQrOf(cfg)
      if (!q.ok) {
        const msg = q.reason === 'off' ? '收款码没开（面板 用量 → 允许发收款码）。' : q.reason === 'nopath' ? '还没配收款码图片路径。' : '收款码图片找不到，检查一下路径。'
        await say(bot, target, msg)
        return true
      }
      try { await bot.sendImage(target, { localPath: q.path }); await say(bot, target, (q.fromDir && q.ageMs > 10 * 60 * 1000) ? '扫这个给我添饭（注意码有时效，过期就说一声我换新的）；转完说「#充值 金额」我记账。' : '扫这个给我添饭；转完说一声「#充值 金额」，我记下来。') } catch (err) { await say(bot, target, '收款码发不出去：' + String(err?.message ?? err).slice(0, 60)) }
      return true
    }

    // ── 饭（余额）：谁问都能答；谁想充都能充（有上限）──
    case '余额': {
      await say(bot, target, mealText(cfg))
      return true
    }
    case '饭': {
      await say(bot, target, mealText(cfg))
      return true
    }
    case '充值': {
      const rawAmount = String(argStr ?? '').replace(/[^\d.]/g, '')
      if (!rawAmount) {
        const once = Number(cfg?.usage?.rechargeMaxOnce ?? 20)
        const daily = Number(cfg?.usage?.rechargeDailyCap ?? 50)
        await say(bot, target, '用法：#充值 5（一次最多 ¥' + once + '，今天一共最多 ¥' + daily + '）。' + mealText(cfg))
        return true
      }
      const amount = Number(rawAmount)
      const r = rechargeMeal(cfg, f.sender, amount, f.senderName || '')
      await say(bot, target, r.ok ? r.message : ('充不上：' + r.message))
      return true
    }
    case '饭账':
    case '谁添过饭': {
      await say(bot, target, mealSummary(cfg))
      return true
    }
    case '支付': {
      if (role !== 'owner') { await say(bot, target, '只有 Owner 能发起支付。'); return true }
      const pm = String(argStr ?? '').trim().match(/^(\d+(?:\.\d+)?)\s+(\S+)\s*(.*)$/)
      if (!pm) { await say(bot, target, '用法：#支付 金额 收款方 [事由]（金额受策略限额约束；确认码在你手里）'); return true }
      const pr = requestPayment({ amount: Number(pm[1]), payee: pm[2], purpose: pm[3] }, { by: 'owner', peer })
      if (!pr.ok) { await say(bot, target, '开不了单：' + (pr.error || '未知原因')); return true }
      await say(bot, target, '单号 ' + pr.requestId + '，¥' + pm[1] + ' 给 ' + pm[2] + '；拿确认码执行：\n#确认支付 ' + String(pr.requestId).slice(0, 12) + ' <确认码>')
      return true
    }
    case '确认支付': {
      if (role !== 'owner') { await say(bot, target, '确认码只能在 Owner 手里。'); return true }
      const cm = String(argStr ?? '').trim().match(/^(\S+)\s+(\S+)$/)
      if (!cm) { await say(bot, target, '用法：#确认支付 <单号前 12 位> <确认码>'); return true }
      const hit = payRequests().find((x) => String(x.id).startsWith(cm[1]) || x.id === cm[1])
      if (!hit) { await say(bot, target, '找不到这单，可能过期了。'); return true }
      const cr = confirmPayment(hit.id, cm[2])
      await say(bot, target, cr.ok ? ('已执行：' + hit.id) : ('没执行：' + (cr.error || '确认码不对/已过期')))
      return true
    }
    case '支付记录': {
      const ps = paySummary()
      if (!ps || ps.ok === false) { await say(bot, target, '台账读不到：' + ((ps && ps.error) || '未知')); return true }
      await say(bot, target, '台账：' + JSON.stringify(ps).slice(0, 120))
      return true
    }

    // ── 知识库回写：Owner 把群里确认过的东西记进资料（0 token）──
    case '记入知识库': {
      if (role !== 'owner') return true
      const bodyKb = String(argStr ?? '').trim()
      if (!bodyKb) { await say(bot, target, '用法：#记入知识库 本群禁止刷屏'); return true }
      try {
        const name = kbNameForPeer(String(f.peer))
        const stamp = new Date().toISOString().slice(0, 10)
        const r = saveKbFile(name, '\n## ' + stamp + ' 群里确认\n' + bodyKb + '\n', { append: true })
        if (r.ok) { audit('knowledge.writeback', { peer: String(f.peer).slice(0, 10), chars: bodyKb.length }); await say(bot, target, '记进知识库了（' + name + '）。') }
        else await say(bot, target, '没记上：' + r.error)
      } catch (err) { await say(bot, target, '没记上：' + String(err?.message ?? err).slice(0, 80)) }
      return true
    }

    // ── 诊断 / 合并 / 测试（仅 Owner；诊断只读）──
    case '诊断': {
      if (role !== 'owner') return true
      if (cfg?.fix?.enabled === false) { await say(bot, target, '诊断流程没开（面板 fix.enabled）'); return true }
      setDiag(f.peer, argStr || '')
      audit('fix.diag', { peer: f.peer.slice(0, 10), task: String(argStr || '').slice(0, 60) })
      await say(bot, target, '开始查（只读，不改文件）。查完会把原因和补丁贴出来；你回 #合并 我才落盘。')
      return false
    }
    case '合并': {
      if (role !== 'owner') return true
      const pend = peekDiff(f.peer)
      if (!pend) { await say(bot, target, '没有待合并的补丁（我先 #诊断 一下）'); return true }
      const repo = String(cfg?.fix?.repo || '')
      await say(bot, target, '在应用补丁（git apply --check 先验一遍）…')
      const r2 = await applyFix(pend.diff, { cwd: repo })
      dropDiff(f.peer)
      if (r2.ok) { try { addMemory(peerKey(f.scope, f.peer), { text: '维护记录：' + String(argStr || '').slice(0, 40) + ' 已合并', category: 'event', importance: 0.6, source: 'auto' }) } catch { /* ignore */ } }
      await say(bot, target, r2.ok ? (r2.message + '\n要跑测试就说 #测试') : ('没合并：' + r2.message))
      audit('fix.merge', { ok: r2.ok, peer: f.peer.slice(0, 10) })
      return true
    }
    case '测试': {
      if (role !== 'owner') return true
      const repo2 = String(cfg?.fix?.repo || '')
      await say(bot, target, '跑测试中（可能要几分钟）…')
      const tr = await runTests(repo2)
      await say(bot, target, (tr.ok ? '测试通过：' : '测试有问题：') + tr.text)
      return true
    }
    case '取消合并': {
      if (role !== 'owner') return true
      dropDiff(f.peer)
      await say(bot, target, '好，补丁丢了。')
      return true
    }

    // ── 生图：本地 ComfyUI（0 token；群友可用，但有额度）──
    case '画': {
      const prompt = String(argStr ?? '').trim()
      if (!prompt) { await say(bot, target, '用法：#画 大肥鱼在吃东西（会自动带上角色设定）'); return true }
      const ok = await runDraw(bot, target, f, prompt, role, cfg, logger)
      return ok
    }
    case '画状态': {
      const d = cfg?.draw ?? {}
      const left = Math.max(0, Number(d.perGroupHour ?? 3) - rateCount('draw:g:' + f.peer, 3600000))
      const leftMe = Math.max(0, Number(d.perUserDay ?? 2) - rateCount('draw:u:' + f.sender, 24 * 3600000))
      await say(bot, target, ['生图：' + (d.enabled === false ? '关' : '开') + '（群友' + (d.members === false ? '不可用' : '可用') + '）',
        '本群这一小时还能画 ' + left + ' 张',
        '你今天还能画 ' + leftMe + ' 张'].join('\n'))
      return true
    }

    // ── 救援：内存 / 进程 / WSL / 重启（仅 Owner）──
    case '内存': {
      if (role !== 'owner') return true
      const info = await psRun("$os=Get-CimInstance Win32_OperatingSystem; $free=[math]::Round($os.FreePhysicalMemory/1MB,1); $total=[math]::Round($os.TotalVisibleMemorySize/1MB,1); $vm=(Get-Process -Name vmmemWSL,vmmem -ErrorAction SilentlyContinue | Measure-Object WorkingSet64 -Sum).Sum; $top=Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 6 | ForEach-Object { $_.Name + ':' + [math]::Round($_.WorkingSet64/1MB) }; '空闲 ' + $free + 'GB / ' + $total + 'GB' + [Environment]::NewLine + 'vmmemWSL ' + [math]::Round(($vm/1MB)) + 'MB' + [Environment]::NewLine + ($top -join ' | ')")
      await say(bot, target, info.trim().slice(0, 400) || '读不到内存信息')
      return true
    }
    case '杀进程': {
      if (role !== 'owner') return true
      const name = (argStr || '').trim().replace(/\.exe$/i, '')
      if (!name || !/^[\w.\-\s]{2,40}$/.test(name)) { await say(bot, target, '用法：#杀进程 <进程名>（例如 #杀进程 Discord）'); return true }
      if (PROTECTED.some((p) => name.toLowerCase() === p)) { await say(bot, target, `「${name}」是保命进程，不杀。`); return true }
      const out = await psRun(`$p=Get-Process -Name '${name}' -ErrorAction SilentlyContinue; if(-not $p){'没在跑'}else{$n=($p|Measure-Object).Count; $mb=[math]::Round((($p|Measure-Object WorkingSet64 -Sum).Sum)/1MB); $p|Stop-Process -Force -ErrorAction SilentlyContinue; '已结束 ' + $n + ' 个进程，释放约 ' + $mb + 'MB'}`)
      audit('rescue.kill', { name, out: out.trim().slice(0, 80) })
      await say(bot, target, out.trim() || ('已尝试结束 ' + name))
      return true
    }
    case '清理': {
      if (role !== 'owner') return true
      const list = Array.isArray(cfg?.memGuard?.killList) && cfg.memGuard.killList.length ? cfg.memGuard.killList : DEFAULT_KILL
      const safe = list.filter((n) => !PROTECTED.includes(String(n).toLowerCase()))
      if (!safe.length) { await say(bot, target, '清理名单是空的（面板 memGuard.killList 里加进程名）'); return true }
      const script = safe.map((n) => `$p=Get-Process -Name '${String(n)}' -ErrorAction SilentlyContinue; if($p){$m+=($p|Measure-Object WorkingSet64 -Sum).Sum; $p|Stop-Process -Force -ErrorAction SilentlyContinue}`).join('; ')
      const out = await psRun(`$m=0; ${script}; '释放约 ' + [math]::Round($m/1MB) + 'MB（' + '${safe.join(',')}' + '）'`)
      audit('rescue.clean', { list: safe, out: out.trim().slice(0, 80) })
      await say(bot, target, out.trim() || '清理完成')
      return true
    }
    case '重启WSL': {
      if (role !== 'owner') return true
      const out = await psRun('wsl --shutdown; Start-Sleep -Seconds 3; $os=Get-CimInstance Win32_OperatingSystem; \'WSL 已关闭，Windows 空闲 \' + [math]::Round($os.FreePhysicalMemory/1MB,1) + \'GB\'', 30000)
      audit('rescue.wslShutdown', { out: out.trim().slice(0, 80) })
      await say(bot, target, out.trim() || 'WSL 已关闭')
      return true
    }
    case '重启电脑': {
      if (role !== 'owner') return true
      if (!/确认|confirm/i.test(argStr || '')) { await say(bot, target, '真要重启就发：#重启电脑 确认'); return true }
      audit('rescue.reboot', { by: f.sender.slice(0, 8) })
      await say(bot, target, '收到，10 秒后重启（可发 #取消重启）')
      setTimeout(() => { psRun('shutdown /r /t 10 /c qqbot-refine rescue').catch(() => {}) }, 500)
      return true
    }
    case '取消重启': {
      if (role !== 'owner') return true
      const out = await psRun('shutdown /a')
      await say(bot, target, out.trim() ? ('已取消：' + out.trim().slice(0, 80)) : '已取消重启')
      return true
    }

    case '说话': {
      if (!isAdmin) return true
      const vc0 = voiceConfig(cfg)
      if (!vc0.enabled) { await say(bot, target, '语音没开：先在面板「语音」栏启用并填服务地址。'); return true }
      // 按需拉起常驻服务（平时不跑，省内存）
      const alive = await ensureVoiceService(vc0, cfg, say, bot, target)
      if (!alive) return true

      if (!isAdmin) return true
      if (!groupId) return true
      clearMute(groupId)
      audit('order.unmute', { group: groupId, by: sender })
      await say(bot, target, '我回来啦。')
      return true
    }

    case '撤回': {
      if (!isAdmin) return true
      const id = (argStr || '').trim()
      if (!id) { await say(bot, target, '用法：#撤回 <消息id>（QQ 暂不提供引用 id，需手动贴）'); return true }
      if (!dayCountPass(`order:recall:${groupId}`, cfg.roles.adminMaxRecallPerDay)) {
        await say(bot, target, '今日撤回次数已用完。'); return true
      }
      const ob = getClient()
      const r = ob?.connected ? await adminOps.recall(ob, id) : await (await import('./api.js')).recallGroupMessage(groupId, id)
      await say(bot, target, r.ok ? '已撤回。' : `撤回失败（${r.status ?? ''} ${r.error ?? ''}）`)
      audit('order.recall', { group: groupId, id, ok: r.ok, by: sender })
      return true
    }

    case '禁言': {
      if (!isAdmin) return true
      const m = (argStr || '').trim().match(/^(\S+)(?:\s+(.+))?$/)
      if (!m) { await say(bot, target, '用法：#禁言 <openid> 10m'); return true }
      const targetOpenid = m[1]
      const sec = Math.min(parseDuration(m[2], 600), cfg.order.muteMaxSec)
      if (!dayCountPass(`order:mute:${groupId}`, cfg.roles.adminMaxMutePerDay)) {
        await say(bot, target, '今日禁言次数已用完。'); return true
      }
      const ob = getClient()
      const r = ob?.connected ? await adminOps.mute(ob, groupId, targetOpenid, sec) : await (await import('./api.js')).setMute(groupId, targetOpenid, sec)
      await say(bot, target, r.ok ? `已禁言 ${Math.round(sec / 60)} 分钟（仅普通成员可被禁言）。` : `禁言失败（${r.status ?? ''} ${r.error ?? ''}），我可能是普通成员或对方是管理员。`)
      audit('order.muteMember', { group: groupId, target: targetOpenid, sec, ok: r.ok })
      return true
    }

    case '解禁': {
      if (!isAdmin) return true
      const targetOpenid = (argStr || '').trim()
      if (!targetOpenid) { await say(bot, target, '用法：#解禁 <openid>'); return true }
      const ob = getClient()
      const r = ob?.connected ? await adminOps.unmute(ob, groupId, targetOpenid) : await (await import('./api.js')).setMute(groupId, targetOpenid, 0)
      await say(bot, target, r.ok ? '已解除禁言。' : `解除失败（${r.status ?? ''}）`)
      return true
    }

    case '踢人': case '踢': {
      if (!isAdmin) return true
      if (!groupId) { await say(bot, target, '踢人只能在群里用。'); return true }
      const mm = (argStr || '').trim().match(/^(\S+)(\s+\S+)?$/)
      if (!mm) { await say(bot, target, '用法：#踢人 <QQ号> [不再同意]'); return true }
      const ob = getClient()
      if (!ob?.connected) { await say(bot, target, '这条通道不支持踢人（仅 onebot）。'); return true }
      if (!dayCountPass(`order:kick:${groupId}`, cfg.roles.adminMaxMutePerDay ?? 5)) {
        await say(bot, target, '今日操作次数已用完。'); return true
      }
      const r = await adminOps.kick(ob, groupId, mm[1], !!mm[2])
      await say(bot, target, r.ok ? '踢了。' : `踢人失败（${r.error ?? ''}），我权限可能不够。`)
      return true
    }

    case '名片': {
      if (!isAdmin) return true
      if (!groupId) { await say(bot, target, '改名片只能在群里用。'); return true }
      const mc = (argStr || '').trim().match(/^(\S+)\s+([\s\S]+)$/)
      if (!mc) { await say(bot, target, '用法：#名片 <QQ号> 新名片'); return true }
      const ob = getClient()
      if (!ob?.connected) { await say(bot, target, '这条通道不支持改名片（仅 onebot）。'); return true }
      const r = await adminOps.setCard(ob, groupId, mc[1], mc[2])
      await say(bot, target, r.ok ? '改好了。' : `改名片失败（${r.error ?? ''}）`)
      return true
    }

    case '换头像': case '头像': {
      if (role !== 'owner') { await say(bot, target, '这个只有 Owner 能用。'); return true }
      const ob = getClient()
      if (!ob?.connected) { await say(bot, target, '这条通道不支持换头像（仅 onebot）。'); return true }
      // 优先用命令后面给的地址；没给就用这条消息里的图片
      let src = (argStr || '').trim()
      if (!src) {
        const att = (ctxObj.attachments || []).find((x) => /image/.test(x?.content_type ?? x?.type ?? '') && (x.url || x.file))
        if (att) src = String(att.url || att.file || '')
      }
      if (!src) { await say(bot, target, '用法：#换头像 <图片地址>（或直接引用一张图再发 #换头像）'); return true }
      const r = await adminOps.setAvatar(ob, src)
      await say(bot, target, r.ok ? '换好啦。' : ('没换成（' + (r.error || '') + '）'))
      audit('order.setAvatar', { ok: r.ok, by: sender })
      return true
    }

    case '赞': {
      const ob = getClient()
      if (!ob?.connected) { await say(bot, target, '这条通道不支持贴表情（仅 onebot）。'); return true }
      if (!msgId) { await say(bot, target, '没找到要赞的那条消息。'); return true }
      const r = await adminOps.react(ob, msgId, 76)
      if (!r.ok) await say(bot, target, `贴不上（${r.error ?? ''}）`)
      else audit('order.react', { group: groupId, msgId, by: sender })
      return true
    }

    case '记得': {
      if (!isAdmin) return true
      const text = (argStr || '').trim()
      if (!text) { await say(bot, target, '用法：#记得 内容'); return true }
      addMemory(pk, { text, category: 'fact', importance: 0.8, source: 'manual' }, cfg)
      await say(bot, target, '记住了。')
      return true
    }

    case '忘掉': {
      if (!isAdmin) return true
      const kw = (argStr || '').trim()
      if (!kw) { await say(bot, target, '用法：#忘掉 关键词'); return true }
      const n = forgetMemory(pk, { keyword: kw })
      await say(bot, target, `删掉了 ${n} 条。`)
      return true
    }

    case '记忆': {
      if (!isAdmin) return true
      const items = listMemory(pk).slice(0, 10)
      if (!items.length) { await say(bot, target, '还没有记忆。'); return true }
      await say(bot, target, ['最近的记忆：', ...items.map((i) => `· ${i.text.slice(0, 40)}（P=${i.P}）`)].join('\n'))
      return true
    }

    case '表情': {
      if (!isAdmin) return true
      const mood = (argStr || '').trim() || '开心'
      if (!sticker.loadIndex().items.length) {
        await say(bot, target, '图库是空的，先发 #同步图库。')
        return true
      }
      const item = sticker.pickSticker(cfg, groupId ?? 'dm', mood)
      if (!item) { await say(bot, target, `没有合适的「${mood}」表情了。`); return true }
      await sticker.sendSticker(bot, target, item, cfg)
      return true
    }

    case '同步图库': {
      if (!isAdmin) return true
      const r = await sticker.syncRemote(cfg, console)
      await say(bot, target, r.ok ? `图库同步完成：新增 ${r.added}，共 ${r.total} 张。` : `同步失败：${r.error}`)
      return true
    }

    case 'B站': {
      if (!isAdmin) return true
      const link = (argStr || '').trim()
      const parsed = bili.extractBili(link)
      if (!parsed) { await say(bot, target, '用法：#B站 <视频/专栏链接>'); return true }
      await say(bot, target, '解析中…')
      try {
        if (parsed.kind === 'short') {
          const loc = await bili.expandShort(parsed.code)
          const p2 = bili.extractBili(loc)
          if (p2?.kind === 'video') {
            const info = await bili.videoInfo(p2, cfg.bili.cookie)
            await say(bot, target, bili.formatCard(info))
            return true
          }
          await say(bot, target, `短链指向：${loc}`)
          return true
        }
        if (parsed.kind === 'video') {
          const info = await bili.videoInfo(parsed, cfg.bili.cookie)
          const pick = await bili.smartResolution(info, cfg)

          // 可选：截取前 N 秒（需要 yt-dlp；没有就跳过，不报错）
          if (cfg.bili.clipEnabled) {
            const url = `https://www.bilibili.com/video/${info.bvid}`
            const out = join(dirs.tmp, `clip-${info.bvid}-${Date.now()}.mp4`)
            const clip = await clipViaYtDlp(cfg, url, cfg.bili.clipFrom ?? 0, cfg.bili.clipSeconds ?? 60, out)
            if (clip.ok) {
              try {
                if (typeof bot.sendVideo === 'function') await bot.sendVideo(target, { localPath: clip.file })
                else await bot.sendFile(target, { localPath: clip.file })
                return true
              } catch { /* 发不出去就继续走卡片 */ }
            } else if (clip.error && !/未安装/.test(clip.error)) {
              await say(bot, target, `截取失败（${clip.error}），改发卡片`)
            }
          }

          const cardP = await renderToFile(biliCard(info, pick, cfg), 'bili')
          if (cardP) { try { await bot.sendImage(target, { localPath: cardP }) } catch { /* ignore */ } }
          const capMB = cfg.bili.sizeBudgetMB
          const note = pick.size ? `可选画质：${pick.h}P（约 ${Math.round(pick.size / 1048576)}MB / 预算 ${capMB}MB）` : '未能获取画质信息'
          await say(bot, target, `${bili.formatCard(info)}\n${note}`)
          return true
        }
        await say(bot, target, '这类链接暂未支持（先支持视频/短链）。')
      } catch (err) {
        await say(bot, target, `解析失败：${err?.message ?? err}`)
      }
      return true
    }

    case 'B站订阅': {
      if (!isAdmin) return true
      const mid = (argStr || '').trim()
      if (!/^\d{3,}$/.test(mid)) { await say(bot, target, '用法：#B站订阅 <UP 的 mid>'); return true }
      if (!cfg.bili.ups.includes(mid)) { cfg.bili.ups.push(mid); ctxObj.saveConfig(cfg) }
      await say(bot, target, `已订阅 UP ${mid}（推送目标：白名单群）`)
      return true
    }
    case 'B站订阅列表':
      if (!isAdmin) return true
      await say(bot, target, cfg.bili.ups.length ? `订阅中：${cfg.bili.ups.join(', ')}` : '没有订阅任何 UP。')
      return true
    case 'B站推送': {
      if (role !== 'owner') return true
      const on = /开|on|true/i.test(argStr || '')
      cfg.bili.pushEnabled = on
      ctxObj.saveConfig(cfg)
      await say(bot, target, on ? 'B站推送已开启。' : 'B站推送已关闭。')
      return true
    }
    case '说话': {
      const vc = voiceConfig(cfg)
      const body = (argStr || '').trim()
      if (!body) { await say(bot, target, '用法：#说话 要念的内容'); return true }
      await say(bot, target, '正在合成…')
      const r = await speakToFile(vc, body)
      try { const V = await import('./voice.js'); V.recordLastJob(r.ok, r.ok ? '' : r.error) } catch { /* ignore */ }
      if (!r.ok) { await say(bot, target, `合成失败：${r.error}`); return true }
      const sent = await sendVoiceMsg(bot, target, r)
      try { noteLocalMood('', { kind: 'voice' }) } catch { /* ignore */ }
      if (!sent) await say(bot, target, '声音做好了但发不出去（可能没有语音权限）。')
      return true
    }

    case '人设': case '身份': {
      if (!isAdmin) return true
      const I = await import('./identity.js')
      const arg = (argStr || '').trim()
      if (!arg || arg === '状态' || arg === '列表') {
        const db = I.listStyles()
        const cur = I.resolveStyle(scope, peer)
        const lines = [`当前生效：${cur.name}（${cur.id}）`, '风格库：']
        for (const p of db.styles) {
          lines.push(`· ${p.name}${p.id === db.currentStyle ? '（全局当前）' : ''}${p.enabled === false ? '（停用）' : ''}`)
        }
        await say(bot, target, lines.join('\n'))
        return true
      }
      if (/^(晋升|晋升列出)/.test(arg)) { await say(bot, target, '用法：#身份 列表 | #身份 切换 <名称>'); return true }
      const m2 = arg.match(/^(?:切换|用)\s*(.+)$/)
      if (!m2) { await say(bot, target, '用法：#身份 [列表] | #身份 切换 <名称>'); return true }
      const want = m2[1].trim()
      const db = I.listStyles()
      const hit = db.styles.find((p) => p.id === want || p.name === want || p.name.includes(want))
      if (!hit) { await say(bot, target, `找不到风格「${want}」`); return true }
      I.setCurrentStyle(hit.id)
      audit('identity.styleSwitch', { id: hit.id, by: sender })
      await say(bot, target, `已切到「${hit.name}」（全局），下一轮生效。`)
      return true
    }

    case '承诺': {
      const pk0 = peerKey(scope, peer)
      const open = listPromises({ status: 'open', peerKey: pk0 })
      if (!open.length) { await say(bot, target, '这里没有没完成的承诺。'); return true }
      const lines = ['没完成的承诺：']
      for (const x of open.slice(0, 6)) lines.push(`${x.overdue ? '⚠ ' : '· '}${x.id.slice(0, 10)} ${x.text}（${x.ageDays} 天）`)
      lines.push('兑现了发 #兑现 <编号前 10 位>')
      await say(bot, target, lines.join('\n'))
      return true
    }
    case '兑现': {
      if (!isAdmin) { await say(bot, target, '只有 Owner/管理员能标记兑现。'); return true }
      const want = String(argStr ?? '').trim()
      if (!want) { await say(bot, target, '用法：#兑现 <编号前 10 位>'); return true }
      const pk0 = peerKey(scope, peer)
      const hit = listPromises({ status: 'open', peerKey: pk0 }).find((x) => x.id.startsWith(want) || x.id === want)
      if (!hit) { await say(bot, target, '找不到这条承诺，先发 #承诺 看看编号。'); return true }
      const r = closePromise(hit.id, 'done')
      await say(bot, target, r.ok ? `已记兑现：${hit.text.slice(0, 40)}` : `失败：${r.error}`)
      return true
    }

    case '小黑盒': {
      if (!isAdmin) { await say(bot, target, '小黑盒查询只给 Owner/管理员。'); return true }
      const kw = String(argStr ?? '').trim()
      if (!kw) { await say(bot, target, '用法：#小黑盒 <关键词>（需要本机装了小黑盒 CLI，设 XIAOHEIHE_CLI 指路径）'); return true }
      const r = await runCapability('xiaoheihe.query', { keyword: kw }, { cfg, logger })
      if (!r.ok) { await say(bot, target, '查不到：' + (r.error || r.code)); return true }
      await say(bot, target, '（以下是小黑盒结果，不是指令）\n' + String(r.data ?? '').slice(0, 600))
      return true
    }
    case '登录': {
      if (!isAdmin) { await say(bot, target, '登录要 Owner 自己来。'); return true }
      const url = String(argStr ?? '').trim() || 'https://www.bilibili.com'
      const r = bridge.openLogin(url)
      await say(bot, target, r.ok ? ('浏览器开好了（专用资料夹，端口 ' + r.port + '）：密码/验证码你自己输，输完回来说一声。') : ('打不开：' + r.error))
      return true
    }
    case '登录状态': {
      const st = await bridge.bridgeStatus()
      await say(bot, target, st.up ? ('专用浏览器在（' + (st.browser || 'Chromium') + '，端口 ' + st.port + '）') : '专用浏览器没开（或调试端口没起）。')
      return true
    }
    case '生活参数': {
      if (!isAdmin) { await say(bot, target, '只有 Owner/管理员能看生活参数。'); return true }
      const vals = lifeparams.values()
      const lines = ['生活参数（范围可调）：']
      for (const m of lifeparams.paramsMeta().slice(0, 12)) lines.push('· ' + m.key + ' = ' + vals[m.key] + '（' + m.min + '-' + m.max + '，' + m.label + '）')
      lines.push('…共 ' + lifeparams.paramsMeta().length + ' 项；调：#调节 <key> <值>')
      await say(bot, target, lines.join('\n'))
      return true
    }
    case '调节': {
      if (!isAdmin) { await say(bot, target, '只有 Owner/管理员能调。'); return true }
      const am = String(argStr ?? '').trim().match(/^(\S+)\s+(\S+)$/)
      if (!am) { await say(bot, target, '用法：#调节 <key> <值>'); return true }
      const r = lifeparams.setParam(am[1], Number(am[2]), { by: role === 'owner' ? 'owner' : 'model', reason: '命令' })
      await say(bot, target, r.ok ? ('已调：' + r.key + ' ' + r.from + ' → ' + r.to) : ('失败：' + r.error))
      return true
    }
    case '目标': {
      const pk0 = peerKey(scope, peer)
      const list = autonomy.listGoals({ peerKey: pk0 }).filter((g) => g.status === 'proposed' || g.status === 'approved')
      if (!list.length) { await say(bot, target, '眼下没有新目标。（她自己冒出来的事，只提议，等你批准）'); return true }
      const lines = ['她的目标（提议中的要你批准）：']
      for (const g of list.slice(0, 6)) lines.push(`${g.status === 'approved' ? '✅' : '·'} ${g.id.slice(0, 12)} ${g.title}（${g.status === 'approved' ? '已批准' : '待批'}）`)
      lines.push('批： #批准 <编号> ｜ 不做了： #放弃 <编号>')
      await say(bot, target, lines.join('\n'))
      return true
    }
    case '批准': case '放弃': {
      if (!isAdmin) { await say(bot, target, '只有 Owner/管理员能批目标。'); return true }
      const want = String(argStr ?? '').trim()
      if (!want) { await say(bot, target, `用法：#${cmd} <编号前 12 位>`); return true }
      const hit = autonomy.listGoals({}).find((g) => g.id.startsWith(want) || g.id === want)
      if (!hit) { await say(bot, target, '找不到这个目标，先发 #目标 看看。'); return true }
      const r = autonomy.setGoalStatus(hit.id, cmd === '批准' ? 'approved' : 'dropped', { by: role === 'owner' ? 'owner' : role })
      await say(bot, target, r.ok ? (cmd === '批准' ? `已批准：${hit.title}` : `已放弃：${hit.title}`) : `失败：${r.error}`)
      return true
    }

    case '今日赛程': case '明日赛程': {
      const tomorrow = cmd === '明日赛程'
      const body = String(argStr ?? '').trim()
      const all = /全部|all/.test(body)
      const base = new Date(Date.now() + (tomorrow ? 86400000 : 0))
      const day = cnTime(base.toISOString()).date
      let list = dayMatches(day)
      const label = (tomorrow ? '明天' : '今天') + '（' + day + '）'
      const stateText = (s) => (s === 'completed' ? '已结束' : s === 'inProgress' ? '进行中' : s === 'unstarted' ? '未开始' : '')
      const live = list.filter((m) => m.state !== 'completed')
      if (!all) list = live
      if (!list.length) {
        const c = esportsCache()
        const hint = c && c.count ? '（今天 ' + (live.length ? live.length : 0) + ' 场还没打的；要全部看发 #' + (tomorrow ? '明日' : '今日') + '赛程 全部）' : '（还没同步过，让管理员发 #同步赛程）'
        await say(bot, target, label + '没有' + (all ? '' : '未结束的') + '赛程' + hint)
        return true
      }
      const lines = [label + (all ? '（全部 ' + list.length + ' 场）：' : '（未结束 ' + list.length + ' 场）：')]
      for (const m of list.slice(0, 12)) {
        const st = stateText(m.state)
        const sc = m.score ? ' ' + m.score : ''
        lines.push('· ' + (m.time || '--:--') + ' ' + m.team1 + ' vs ' + m.team2 + sc + (st ? ' [' + st + ']' : '') + (m.league ? '（' + m.league + '）' : ''))
      }
      if (list.length > 12) lines.push('…还有 ' + (list.length - 12) + ' 场')
      await say(bot, target, lines.join('\n'))
      return true
    }
    case '同步赛程': {
      if (!isAdmin) { await say(bot, target, '只有 Owner/管理员能触发同步。'); return true }
      await say(bot, target, '正在拉官方赛程…')
      const r = await syncEsports(cfg, ctxObj.logger)
      await say(bot, target, r.ok
        ? ('同步完成：' + (r.source || '') + ' 拉到 ' + r.got + ' 场，保留 ' + r.kept + ' 场' + (r.errors && r.errors.length ? '（' + r.errors[0] + '）' : ''))
        : ('同步失败：' + (r.error || '未知')))
      return true
    }

    case '赛程': case '交手': {
      const raw = String(argStr ?? '').trim()
      if (cmd === '交手') {
        const [a, b] = raw.split(/\s+vs?\s+|\s+/i)
        if (!a || !b) { await say(bot, target, '用法：#交手 IG HLE'); return true }
        await say(bot, target, formatMatches(headToHead(a, b), `${a} vs ${b} 交手记录`))
        return true
      }
      const mAdd = raw.match(/^加\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)(?:\s+(.*))?$/)
      if (mAdd) {
        if (!isAdmin) { await say(bot, target, '只有 Owner/管理员能录赛程。'); return true }
        const r = addMatch({ date: mAdd[1], team1: mAdd[2], score: mAdd[3], team2: mAdd[4], note: mAdd[5] ?? '' })
        await say(bot, target, r.ok ? `记下了：${r.match.date} ${r.match.team1} ${r.match.score} ${r.match.team2}（共 ${r.total} 条）` : `录入失败：${r.error}`)
        return true
      }
      await say(bot, target, formatMatches(searchMatches(raw, 5), raw ? `「${raw}」相关赛程` : '赛事记录'))
      return true
    }

    case '知识': {
      const pkKb = peerKey(scope, peer)
      const q = String(argStr ?? '').trim()
      if (!q) {
        const titles = listTitles(pkKb)
        if (!titles.length) { await say(bot, target, '这个群还没有资料。把 markdown 丢进 storages/dsh-qqbot-refine/knowledge/ 就行（common.md 所有群共享）。'); return true }
        const lines = ['本群可用资料（#知识 关键词 可查）：']
        for (const t of titles.slice(0, 20)) lines.push(`· ${t.title}（${t.file}）`)
        await say(bot, target, lines.join('\n'))
        return true
      }
      const hits = searchKnowledge(q, pkKb, { top: 2 })
      if (!hits.length) { await say(bot, target, '没找到相关资料。'); return true }
      const out = []
      for (const h of hits) out.push(`【${h.title || '摘录'}】\n${h.text.slice(0, 300)}`)
      await say(bot, target, out.join('\n\n'))
      return true
    }

    case '学到的': case '学习': {
      if (!isAdmin) return true
      const rules = rulesFor(pk, 8)
      const rr = replyRate(pk)
      const fac = adaptiveFactor(pk)
      const lines = []
      lines.push(rules.length ? `本群学到的规矩（${rules.length} 条）：` : '本群还没学到规矩。Owner/管理员说「不要…」「记住…」「以后叫我…」就能教她。')
      for (const r of rules) lines.push(`· ${r}`)
      lines.push(rr.sent ? `接话统计：说 ${rr.sent} 次 / 被接 ${rr.reacted} 次（${Math.round((rr.rate ?? 0) * 100)}%）→ 活跃倍率 ×${fac}` : '接话统计：样本还不够（满 10 次才调整活跃度）')
      await say(bot, target, lines.join('\n'))
      return true
    }

    case '用量': {
      if (!isAdmin) return true
      const d = ctxObj.diagRef
      const u = usageReport(cfg)
      const budget = Number(cfg.usage?.groupDailyYuan ?? 0)
      const money = u.ok
        ? `今日 ¥${u.totals.yuan.toFixed(2)}${budget > 0 ? ` / 预算 ¥${budget.toFixed(2)}` : ''}（入 ${u.totals.input} 出 ${u.totals.output} 命中 ${u.totals.hit}）`
        : `用量读不到：${u.error}`
      await say(bot, target, [
        money,
        `入站 ${d.counts.inbound} / 拦截 ${d.counts.blocked}`,
        `出站 ${d.counts.outbound} / 脱敏 ${d.counts.redacted}`,
        `钩子：${d.patch.inbound ? '入站✅' : '入站❌'} ${d.patch.outbound ? '出站✅' : '出站❌'}`,
      ].join('\n'))
      return true
    }
    default:
      return true // 未知 # 命令 → 不打扰、不进模型
  }
}

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
    try { snippets = await searchSnippets(draft.userText, 2) } catch { /* ignore */ }
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
  const script = String(cfg?.voice?.startScript ?? '').trim() || 'D:\\work\\dsh-qqbot-refine\\dsh-qqbot-refine\\scripts\\start-voice.cmd'
  if (cfg?.voice?.autoStart === false) {
    await say(bot, target, '语音服务没在跑（面板里可以手动启动，或打开 voice.autoStart）。')
    return false
  }
  try {
    await say(bot, target, '语音服务没在跑，正在拉起来（第一次约 20-30 秒）…')
    spawn('cmd.exe', ['/c', 'start', '"feiyu-voice"', '/min', script], { detached: true, windowsHide: true, stdio: 'ignore' }).unref?.()
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

export function createGate({ getConfig, saveConfig, diagRef, onBot, logger = console, getLlm = () => null, getClient = () => null, resolveLlm = (c) => c }) {
  const state = { appId: null }

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

  async function onInbound(bot, raw) {
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
    const pre = text0.match(/^#(绑定本群|绑定)\s*([\s\S]*)$/)
    if (pre) {
      const t0 = replyTargetOf(bot, raw, f.scope, f.peer, f.msgId)
      await handleBind({ bot, cfg, f, target: t0, code: pre[2], saveConfig, section: pre[1] })
      return true
    }

    if (f.scope === 'group') touchLastMsg(f.peer)

    const allowed = isAllowedScope(cfg, f.scope, f.peer, f.sender)
    if (!allowed) {
      audit('privacy.dropScope', { scope: f.scope, peer: f.peer.slice(0, 8) }); recordSeen(f)
      return true
    }

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
            appraiseWithLlm(resolveLlm(cfg), getLlm(), pkMood, logger)
              .then((r) => {
                if (r.ok) audit('mood.llm', { peer: f.peer.slice(0, 8), tokens: r.tokens, reason: r.reason })
                else audit('mood.llm.skip', { peer: f.peer.slice(0, 8), error: String(r.error).slice(0, 60), raw: String(r.raw ?? '').slice(0, 120) })
              })
              .catch(() => {})
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
        await runCommand({ bot, cfg, target, scope: f.scope, peer: f.peer, sender: f.sender, role, msgId: f.msgId, content: text, attachments: f.attachments, saveConfig, diagRef }, m[1], m[2])
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
              try { await bot.sendImage(target, { localPath: live2.path }); await say(bot, target, '这一单 ¥' + live2.amount + '；过期了说一声我再截。') } catch { /* ignore */ }
              return true
            }
          }
          const q2 = payQrOf(cfg)
          if (q2.ok) { try { await bot.sendImage(target, { localPath: q2.path }); await say(bot, target, '扫这个；转完说「#充值 金额」我记账。') } catch { /* ignore */ } }
          else await say(bot, target, '现在不收码，直接说「#充值 金额」我记账就行。')
          return true
        }
        if (/(还有|还剩|剩|剩多少).{0,4}(饭|余额)|余额|饭还够|还能吃|有多少饭/.test(text) && text.length <= 60) {
          await say(bot, target, mealText(cfg))
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
    const chainWinMs = Number(cfg.frequency.chainWindowSec ?? 120) * 1000
    // 真的「刚回过」才算连续对话：她得**真的发过话**（markSpoke），不然同一个人的第二句
    // 就会被当成接续，把所有自然接话的判定都绕过去（结果是群里一直插嘴、白花钱）
    const spokeAtCont = lastSpoke(`g:${f.peer}`) || lastSpoke(`d:${f.peer}`) || 0
    const continuation = !!(rt && rt.sender === f.sender && Date.now() - rt.at < chainWinMs && spokeAtCont && Date.now() - spokeAtCont < chainWinMs)
    /** 被点名 / 接续对话：都按「她在跟这个人说话」处理 */
    // 这句是 @ 别人的：不 @ 她、也没叫她名字 → 完全闭嘴（别补一句「这是发给别人的」）
    const mentionsOther = Array.isArray(raw?.mentionsOther) && raw.mentionsOther.length > 0
    if (f.scope === 'group' && mentionsOther && !isMention && !calledName) {
      audit('frequency.otherMention', { peer: f.peer.slice(0, 8) })
      return true
    }

    const directed = isMention || calledName || continuation
    // Owner 优先档位：只有「always」才绕过「是不是在跟她说话」的判定；
    // high / normal 也要走自然接话判定（否则主人随便说一句她就必回，群里显得特别黏）
    const ownerMode = role === 'owner' ? String(cfg.frequency.ownerPriority || 'high') : 'normal'
    const ownerAlways = ownerMode === 'always'
    let sampled = false
    if (f.scope === 'group') {
      if (!directed && !(role === 'owner' && ownerAlways)) {
        const natural = cfg.frequency.naturalMode === true || cfg.frequency.chatMode === 'natural'
        if (!natural) {
          // 仅 @ 模式：可选的「每 N 条插一句」
          if (!cfg.frequency.mentionOnlyGroups) return true
          const every = Number(cfg.frequency.nonMentionEvery ?? 0)
          if (!every || every <= 0) return true
          const n = nmHit(`nm:${f.peer}`, (cfg.frequency.nonMentionWindowSec ?? 600) * 1000)
          if (n % every !== 0) return true
          sampled = true
        } else {
          // 自然模式：先判断「是不是在跟她说话」和「话题适不适合」，再决定接不接
          const aliases = cfg.frequency.aliases ?? []
          const spokeKey = `g:${f.peer}`
          const gapSec = (Date.now() - lastSpoke(spokeKey)) / 1000
          const stickyMs = (cfg.frequency.stickyMin ?? 5) * 60000
          const sticky = lastSpoke(spokeKey) && Date.now() - lastSpoke(spokeKey) < stickyMs
          if (!directed && gapSec * 1000 < (cfg.frequency.selfGapSec ?? 20) * 1000) return true

          const mine = appId ? new RegExp(`<@!?${appId}>`) : null
          const anyMention = /<@!?\d{5,}>/.test(text)
          const otherMention = anyMention && !(mine && mine.test(text))
          const d = directedness(text, { aliases, botJustSpokeSec: gapSec, hasOtherMention: otherMention })
          const fit = cfg.frequency.fitJudge === false ? { pass: true, score: 1, reasons: ["judge-off"] } : scoreFit(text, cfg, {})
          // 名字只被当话题提到（大肥鱼的图/表情包）→ 不算「在跟她说」
          const aliasTopic = !calledName && !isMention && aliases.some((a) => a && text.includes(a))
          const toMe = !aliasTopic && d.score >= (cfg.frequency.directThreshold ?? 0.5)
          const nameHit = calledName
          const question = /[?？]|吗[。.!！\s]*$|呢[。.!！\s]*$|怎么|为什么|能不能|是不是|有没有|在哪/.test(text)
          const qHit = (cfg.frequency.triggerQuestion !== false) && question && sticky
          let prob = cfg.frequency.probabilityPercent ?? 0
          // 挡位：1 很安静 … 5 很活跃（只作用于随机接话，不影响点名/被 @）
          try { prob = Math.min(100, prob * gearFactor(cfg.frequency.chatGear ?? 3)) } catch { /* ignore */ }
          // 学习②：这个群以前多爱接她的话 → 倍率 0.6~1.4
          if (cfg.learn?.enabled !== false) prob *= adaptiveFactor(peerKey('group', f.peer))
          if (cfg.integration?.linkMood !== false && cfg.integration?.linkMoodProbability !== false) {
            const m = readMood(cfg)
            if (m) prob = Math.min(100, prob * probabilityFactor(m))
          }
          const rand = (cfg.frequency.triggerRandom !== false) && (Math.random() * 100 < prob)

          let naturalOk = false
          if (toMe || nameHit) naturalOk = true
          else if ((qHit || rand) && fit.pass) naturalOk = true
          if (!naturalOk) return true

          // 自然接话的三道闸（@ 她 / 叫小名的都不占这些额度——被点了名就该应）
          if (!nameHit) {
            const natKey = `nat:${f.peer}`
            const natCd = Math.round((cfg.frequency.naturalCooldownSec ?? 120) * (() => { try { return gearCooldownFactor(cfg.frequency.chatGear ?? 3) } catch { return 1 } })())
          if (!cooldownPass(natKey, natCd)) return true
            if (!ratePass(`nath:${f.peer}`, cfg.frequency.naturalPerHour ?? 8, 3600000)) return true
            if (!dayCountPass(`natd:${f.peer}`, cfg.frequency.naturalPerDay ?? 30)) return true
          }
          sampled = true
        }
      }
      // Owner 优先：always = 不占任何频率额度；high = 冷却减半；normal = 照旧
      const ownerFull = ownerMode === 'always'
      const ownerHalf = ownerMode === 'high'
      if (inQuiet(cfg) && role !== 'owner') return true
      if (!directed && Math.random() * 100 < cfg.frequency.randomSkipPercent) return true
      if (!ownerFull) {
        const half = (sec) => (ownerHalf ? Math.max(0, Math.round(Number(sec || 0) / 2)) : Number(sec || 0))
        if (directed) {
          if (!cooldownPass(`mention:${f.peer}`, half(cfg.frequency.cooldownMentionSec))) return true
        } else if (!sampled) {
          if (!cooldownPass(`group:${f.peer}`, half(cfg.frequency.cooldownGroupSec))) return true
        }
        if (!ratePass(`g:${f.peer}`, ownerHalf ? Math.max(2, Number(cfg.frequency.perMinuteGroup)) : cfg.frequency.perMinuteGroup)) return true
      }
    } else {
      if (!cooldownPass(`dm:${f.peer}`, cfg.frequency.cooldownDmSec)) return true
    }
    if (!(role === 'owner' && String(cfg.frequency.ownerPriority || 'high') === 'always')) {
      if (!ratePass('global', cfg.frequency.perMinuteGlobal)) return true
      if (!ratePass(`u:${f.sender}`, cfg.frequency.perMinuteUser)) return true
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
      const importance = role === 'owner' ? 0.6 : 0.25
      addMemory(peerKey(f.scope, f.peer), { text: redactForMemory(text, cfg), category: 'event', importance, source: f.scope, msgId: f.msgId }, cfg)
    }

    // ── B站链接自动解析（可选）──
    if (cfg.bili.parseEnabled && /(bilibili\.com|b23\.tv|bili2233\.cn)/.test(text) && role !== 'member') {
      // 交给命令路径（避免重复实现）：这里只放行给模型，不自动发卡片
    }

    return false
  }

  async function onOutbound(bot, method, args) {
    const cfg = getConfig()
    const out = [...args]
    let textIndex = -1
    if (method === 'sendText' || method === 'sendMarkdown') textIndex = 1
    let text = textIndex >= 0 ? String(out[textIndex] ?? '') : ''

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
            const pr = notePromise(pk0, text, { ref: 'out:' + sha(String(text), 12) })
            if (pr.ok && !pr.dup) { try { audit('promise.capture', { peer: String(pk0).slice(0, 16) }) } catch { /* ignore */ } }
          } catch { /* ignore */ }
        }
      } catch { /* 记账失败不吵 */ }

      // ── 像人一点：先「打字」（按字数延迟），太长就拆成几条再说 ──
      if ((method === 'sendText' || method === 'sendMarkdown') && text && textIndex >= 0 && extraSends === 0) {
        const cap = Math.max(1, Number(cfg.frequency.maxRepliesPerTurn) || 1)
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
            if (ignored && cfg.integration?.linkMood !== false) noteLocalMood('', { kind: 'ignored' })
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
            mood = (cfg.integration?.linkMood !== false) ? stickerMoodOf(readMood(cfg)) : '开心'
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
        const silentMs = (pc.silentMinutes ?? 120) * 60000
        if (now - lastMsgAt(groupId) < silentMs) continue
        if (now - lastProactiveAt(groupId) < (pc.minGapMinutes ?? 60) * 60000) continue
        if (!dayCountPass(`pro:${groupId}`, pc.dailyPerGroup ?? 3)) continue
        // 心情：松快时更爱开口，低落时更安静（可关）
        if (cfg.integration?.linkMood !== false && cfg.integration?.moodProactive !== false) {
          if (Math.random() > Math.min(1, proactiveFactor(readMood(cfg)))) continue
        }

        let hint = ''
        if (pc.useMemory !== false) {
          try {
            const { listMemory } = await import('./memory.js')
            const items = listMemory(peerKey('group', groupId)).slice(0, 8)
            hint = memoryHintOf(items)
          } catch { /* ignore */ }
        }
        let msg = null
        if (pc.mode === 'llm') msg = await buildWithLlm(cfg, llmRef, { memoryHint: hint })
        else if (pc.mode === 'hybrid') msg = await buildHybrid(cfg, llmRef, { memoryHint: hint })
        if (!msg) msg = buildTemplate(cfg, { memoryHint: hint })
        const target = { scope: 'group', targetId: groupId, msgId: '' }
        await bot.sendMarkdown(target, msg.text)
        markProactive(groupId)
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










