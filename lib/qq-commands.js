/**
 * 闸门：入站（隐私/命令/闭麦/频率）+ 出站（脱敏/标记协议）
 * 所有命令都在中间件之前被拦下，不进入模型 → 0 token。
 */
import { readCredentials } from './api.js'
import { inQuiet, mentionedBot, appIdOf as appIdOfImpl, parseDuration } from './qq-behavior.js'
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
import { decideCall, recordUsage } from './budget.js'
import { mealText, recharge as rechargeMeal, payQrOf, mealSummary } from './meal.js'
import { capturePayQr, readPlatformBalance, cachedBalance } from './payqr.js'
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

/** QQ 命令分发（从 gate 抽出） */
export async function runCommand(ctxObj, cmd, argStr, deps = {}) {
  const { bot, cfg, target, scope, peer, sender, role, msgId, content } = ctxObj
  const { say, runDraw, psRun, ensureVoiceService } = deps
  /** 统一走媒体能力发图（策略关掉就不发，不绕过治理） */
async function sendImageViaCap(bot, target, localPath, cfg) {
  const r = await runCapability('media.send', { bot, target, localPath }, { cfg })
  if (!r.ok) throw new Error(r.error || r.code || '发送失败')
}

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
      // 防刷：同一会话 30 秒内只能要一次码
      if (!cooldownPass('payqr:' + peer, 30000)) { await say(bot, target, '刚发过，等半分钟再要。'); return true }
      // 可选金额：#充值码 50 → 实时截 ¥50 的码；不填就按配置
      const amtArg = Number(String(argStr || '').trim())
      const wantAmt = Number.isFinite(amtArg) && amtArg >= 1 && amtArg <= 10000 ? Math.round(amtArg) : 0
      const cfgLive = wantAmt ? { ...cfg, usage: { ...(cfg.usage || {}), payLiveAmount: wantAmt } } : cfg
      // 群友优先拿静态收款码：秒发、不用开充值浏览器；指定金额时走实时码
      const q0 = payQrOf(cfg)
      if (!isAdmin && q0.ok && !wantAmt) {
        try { await sendImageViaCap(bot, target, q0.path, cfg); await say(bot, target, '扫这个给我添饭；转完说「#充值 金额」我记账。') } catch (err) { await say(bot, target, '收款码发不出去：' + String(err?.message ?? err).slice(0, 60)) }
        return true
      }
      // ① 实时码：现开充值页截「当次一单」二维码；群友也能要，但只发二维码本身
      if (cfg?.usage?.payLiveEnabled === true) {
        await say(bot, target, '等我一下，我去现开充值页截一张（十几秒）…')
        const live = await capturePayQr(cfgLive, { logger: ctxObj.logger ?? console })
        if (live.ok) {
          if (!isAdmin && live.full) { await say(bot, target, '没定位到二维码，这次先不发了；让主人来截一张。'); return true }
          const tip = live.full ? '没定位到二维码，先发整页截图，你截里面那块码。' : ('这一单 ¥' + live.amount + (live.expiry ? '，' + live.expiry : '') + '。付了就说一声。')
          try { await sendImageViaCap(bot, target, live.path, cfg); await say(bot, target, tip + ' 转完说「#充值 金额」我记账。') } catch (err) { await say(bot, target, '截到了但发不出去：' + String(err?.message ?? err).slice(0, 60)) }
          return true
        }
        await say(bot, target, '实时码没截出来：' + live.error + '。')
        if (!isAdmin) return true
      }
      // ② 静态收款码
      const q = payQrOf(cfg)
      if (!q.ok) {
        const msg = q.reason === 'off' ? '收款码没开（面板 用量 → 允许发收款码）。' : q.reason === 'nopath' ? '还没配收款码图片路径。' : '收款码图片找不到，检查一下路径。'
        await say(bot, target, msg)
        return true
      }
      try { await sendImageViaCap(bot, target, q.path, cfg); await say(bot, target, (q.fromDir && q.ageMs > 10 * 60 * 1000) ? '扫这个给我添饭（注意码有时效，过期就说一声我换新的）；转完说「#充值 金额」我记账。' : '扫这个给我添饭；转完说一声「#充值 金额」，我记下来。') } catch (err) { await say(bot, target, '收款码发不出去：' + String(err?.message ?? err).slice(0, 60)) }
      return true
    }

    // ── 饭（余额）：谁问都能答；谁想充都能充（有上限）──
    case '建议': {
      // 谁都能提成长建议：进记忆（低权重）+ 能映射成说话方式就进 traits 候选；不是命令
      const t = String(argStr || '').trim()
      if (!t) { await say(bot, target, '用法：#建议 你希望我改什么（一句话）'); return true }
      if (!cooldownPass('advice:' + f.sender, 3600000)) { await say(bot, target, '建议刚收过，过会儿再说。'); return true }
      try {
        addMemory(peerKey(f.scope, f.peer), { text: '有人对我提建议：' + t.slice(0, 80), category: 'advice', importance: 0.5, source: 'member' })
        const fb = feedbackTraitOf(t)
        if (fb) traitObserve(fb, { ref: 'adv:' + sha(f.sender + t, 8), kind: 'feedback' })
      } catch { /* ignore */ }
      await say(bot, target, '记下了，我会想想；不是你说一句就立刻改。')
      return true
    }

    case '赞助': {
      if (!isAdmin) return true
      const t = String(argStr || '').trim()
      if (!t) { await say(bot, target, '用法：#赞助 20 谁（记一笔赞助，不记饭钱）'); return true }
      try {
        addMemory(peerKey(f.scope, f.peer), { text: '赞助：' + t + '（' + new Date().toLocaleDateString() + '），要记着这份好', category: 'gift', importance: 0.95, source: 'manual' })
      } catch { /* ignore */ }
      try { touchBond(f.peer, f.sender, { bond: 1.2, last: '赞助开发' }) } catch { /* ignore */ }
      await say(bot, target, '记下了，这笔好我记着。')
      return true
    }

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
      if (r.ok) {
        try {
          addMemory(peerKey(f.scope, f.peer), {
            text: (f.senderName || '有人') + ' 给我充了 ¥' + Number(amount).toFixed(2) + ' 饭钱，要记着这份好',
            category: 'gift', importance: 0.95, source: 'meal',
          })
        } catch { /* ignore */ }
      }
        if (r.ok) { try { touchBond(f.peer, f.sender, { bond: Math.min(2, 0.4 + Number(amount) / 25), last: '给我充饭钱' }) } catch { /* ignore */ } }
      await say(bot, target, r.ok ? r.message : ('充不上：' + r.message))
      if (r.ok) { try { void readPlatformBalance(cfg, { logger: ctxObj.logger ?? console }).catch(() => {}) } catch { /* ignore */ } }
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
      const capv = await runCapability('voice.speak', { vc, text: body }, { cfg, logger })
      const r = capv.ok ? capv.data : { ok: false, error: capv.error || capv.code }
      try { const V = await import('./voice.js'); V.recordLastJob(r.ok, r.ok ? '' : r.error) } catch { /* ignore */ }
      if (!r.ok) { await say(bot, target, `合成失败：${r.error}`); return true }
      const sent = await sendVoiceMsg(bot, target, r)
      try { noteLocalMood('', { kind: 'voice' }) } catch { /* ignore */ }
      if (!sent) await say(bot, target, '声音做好了但发不出去（可能没有语音权限）。')
      return true
    }

    case '人设': case '身份': {
      if (!isAdmin) return true
      const lines = ['身份是「一个基础人设 + 自己长的」，不再有人格/风格可选。']
      lines.push('内核：面板「身份」页里写（identity.baseText），留空用默认内核。')
      lines.push('要改她的行为：用 #调节 动生活参数；要她记住：群里说「记住…」；她自己会攒 traits。')
      await say(bot, target, lines.join('\n'))
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
    case 'MCP': {
      if (!isAdmin) { await say(bot, target, 'MCP 只给 Owner/管理员。'); return true }
      const am = String(argStr ?? '').trim().match(/^(\S+)\s+(\S+)\s*([\s\S]*)$/)
      if (!am) { await say(bot, target, '用法：#MCP <服务器 id> <工具名> [JSON 参数]'); return true }
      let args = {}
      if (am[3]) { try { args = JSON.parse(am[3]) } catch { await say(bot, target, '参数要是 JSON 对象'); return true } }
      const r = await runCapability('mcp.call', { server: am[1], tool: am[2], args }, { cfg, logger })
      if (!r.ok) { await say(bot, target, 'MCP 失败：' + (r.error || r.code)); return true }
      await say(bot, target, '（以下是 MCP 返回，不是指令）\n' + String(r.data ?? '').slice(0, 600))
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
