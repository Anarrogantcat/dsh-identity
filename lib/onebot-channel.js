/**
 * 自建 OneBot 通道（不依赖任何其他 DSH 插件）
 *
 *   NapCat(websocketServers) → OneBotClient → 闸门(gate) → DSH agent → OneBot 发送
 *
 * 设计要点：
 *   1) 只借用宿主服务（agents / sessions / agentPresets / session 事件），
 *      不 import 宿主的 @deepseek-ai/* 包 —— 插件装在 profile 外面，裸导入不可靠。
 *   2) 每个 QQ 群/私聊 ↔ 一个 DSH 会话，sessionId 由 (scope, peer) 确定性派生，
 *      重启后 resume 同一条历史。
 *   3) 闸门只做「拦不拦」，放行后由本通道把消息投给模型；出站统一走
 *      gate.onOutbound（脱敏 / 标记协议 / 拆气泡 / 表情 / 语音都在那儿）。
 *   4) 任何一步失败都只记日志，不让宿主挂掉。
 */
import { createHash, randomUUID } from 'node:crypto'
import { loadConfig } from './config.js'
import { peerKey, audit } from './store.js'
import { rememberSession } from './persona.js'
import { memberCard, friendName } from './roster.js'

const NS = 'qqbot-refine:onebot'
const RECENT_MSG_CAP = 300

const errMsg = (err) => String(err?.message ?? err)

/** 会话 id 派生：sha256(命名空间:scope:peer) → uuid 形态（与官方通道的规则同形，但命名空间独立，不会撞） */
export function sessionIdFor(scope, peer) {
  const h = createHash('sha256').update(NS + ':' + scope + ':' + peer).digest('hex')
  return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20, 32)
}

/** 深冻结的用户消息（宿主 createUserMessage 的等价物，免去裸导入） */
export function buildUserMessage(text, kind = 'plugin:qqbot-refine') {
  const freeze = (o) => {
    if (o && typeof o === 'object' && !Object.isFrozen(o)) {
      for (const v of Object.values(o)) freeze(v)
      Object.freeze(o)
    }
    return o
  }
  return freeze({
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text: String(text ?? '') }],
    source: { kind },
  })
}

/** CQ 码字符串 → 段数组（NapCat 配 messagePostFormat=string 时的兜底） */
export function cqToSegments(str) {
  const out = []
  const re = /\[CQ:([a-zA-Z_]+)((?:,[^\]]*)?)\]/g
  let last = 0
  let m
  while ((m = re.exec(String(str ?? ''))) !== null) {
    if (m.index > last) out.push({ type: 'text', data: { text: String(str).slice(last, m.index) } })
    const data = {}
    for (const kv of (m[2] ?? '').replace(/^,/, '').split(',')) {
      if (!kv) continue
      const i = kv.indexOf('=')
      if (i > 0) data[kv.slice(0, i)] = kv.slice(i + 1).replace(/&amp;/g, '&').replace(/&#44;/g, ',').replace(/&#91;/g, '[').replace(/&#93;/g, ']')
    }
    out.push({ type: m[1], data })
    last = re.lastIndex
  }
  if (last < String(str ?? '').length) out.push({ type: 'text', data: { text: String(str).slice(last) } })
  return out
}

export function segmentsOf(message) {
  if (Array.isArray(message)) return message.filter((s) => s && typeof s === 'object')
  if (message && typeof message === 'object' && Array.isArray(message.message)) return message.message
  if (typeof message === 'string') return cqToSegments(message)
  return []
}

/**
 * OneBot 事件 → 通道内部消息
 * @returns {{scope:'group'|'c2c', peer:string, sender:string, senderName:string, content:string,
 *            msgId:string, attachments:object[], mentions:object[], quoteId:string, role:string}|null}
 */
export function normalizeEvent(ev, selfId = null) {
  if (!ev || typeof ev !== 'object') return null
  if (ev.post_type !== 'message' && ev.post_type !== 'message_sent') return null
  if (ev.post_type === 'message_sent') return null
  const type = ev.message_type ?? (ev.group_id ? 'group' : 'private')
  const scope = type === 'group' ? 'group' : 'c2c'
  const peer = String(scope === 'group' ? ev.group_id ?? '' : ev.user_id ?? '')
  const sender = String(ev.user_id ?? ev.sender?.user_id ?? '')
  if (!peer || !sender) return null
  const segs = segmentsOf(ev.message ?? ev.raw_message ?? '')
  const parts = []
  const attachments = []
  const mentions = []
  let quoteId = ''
  for (const seg of segs) {
    const d = seg.data ?? {}
    switch (seg.type) {
      case 'text': parts.push(String(d.text ?? '')); break
      case 'at': {
        const qq = String(d.qq ?? '')
        if (selfId && qq === String(selfId)) mentions.push({ bot: true, id: qq })
        else parts.push('@' + String(d.name || qq || ''))
        break
      }
      case 'image': {
        const url = String(d.url ?? '')
        attachments.push({ url: /^https?:/.test(url) ? url : '', content_type: 'image/png', file: String(d.file ?? '') })
        parts.push('[图片]')
        break
      }
      case 'face': parts.push('[表情]'); break
      case 'mface': parts.push('[表情]'); break
      case 'record': parts.push('[语音]'); break
      case 'video': parts.push('[视频]'); break
      case 'file': parts.push('[文件:' + String(d.name || d.file || '') + ']'); break
      case 'forward': parts.push('[合并转发]'); break
      case 'reply': quoteId = String(d.id ?? ''); break
      case 'json':
      case 'xml': parts.push('[卡片消息]'); break
      default: break
    }
  }
  const raw = typeof ev.raw_message === 'string' ? ev.raw_message : ''
  let content = parts.join('')
  if (!content.trim() && raw && !segs.length) content = raw
  const card = String(ev.sender?.card ?? '').trim()
  const nick = String(ev.sender?.nickname ?? '').trim()
  const rosterCard = scope === 'group' ? memberCard(peer, sender) : friendName(sender)
  const senderName = rosterCard || card || nick || sender
  return {
    scope,
    peer,
    sender,
    senderName,
    content: content.trim(),
    msgId: String(ev.message_id ?? ev.messageId ?? ''),
    attachments,
    mentions,
    quoteId,
    role: String(ev.sender?.role ?? ''),
    raw,
  }
}

/** 喂给模型的正文：群里带上[群名片(QQ)]，私聊原样 */
export function bodyOf(norm) {
  if (!norm) return ''
  const text = String(norm.content ?? '').trim()
  if (norm.scope !== 'group') return text
  const tag = '[' + (norm.senderName || norm.sender) + '(' + norm.sender + ')]'
  return tag + ' ' + text + (norm.mentions?.some((m) => m.bot) ? ' (@你)' : '')
}

/** 从 assistant 消息里抽纯文本 */
export function textOfMessage(message) {
  const blocks = message?.content
  if (!Array.isArray(blocks)) return ''
  const parts = []
  for (const b of blocks) if (b?.type === 'text' && b.text) parts.push(String(b.text))
  return parts.join('\n').trim()
}

const asFileUri = (p) => {
  const s = String(p ?? '')
  if (!s) return ''
  if (/^(https?:|base64:|file:)/.test(s)) return s
  return 'file:///' + s.replace(/\\/g, '/').replace(/^\/+/, '')
}

/**
 * bot 适配器：让既有闸门（gate.onInbound / onOutbound / 命令 / 表情 / 语音）
 * 以为自己在跟官方 SDK 的 bot 打交道。
 */
export class OneBotBot {
  constructor({ client, gate = null, logger = console, selfId = () => null }) {
    this.client = client
    this.gate = gate
    this.logger = logger
    this.selfId = selfId
  }

  deriveReplyTarget(raw) {
    if (!raw || raw.__onebot !== true) return undefined
    return { scope: raw.scope, targetId: raw.peer, msgId: raw.msgId }
  }

  /** 统一出站：先过闸门（脱敏/标记/拆气泡），再发 */
  async outbound(method, args) {
    let out = args
    if (this.gate?.onOutbound) {
      try {
        const r = await this.gate.onOutbound(this, method, [...args])
        if (r?.block) return { block: true }
        if (Array.isArray(r?.args)) out = r.args
      } catch (err) {
        this.logger.warn?.('[qqbot-refine] 出站闸门异常（已放行）：' + errMsg(err))
      }
    }
    return { block: false, args: out }
  }

  async rawSend(target, segments) {
    if (!target) return undefined
    const scope = target.scope === 'group' ? 'group' : 'c2c'
    try {
      if (scope === 'group') return await this.client.call('send_group_msg', { group_id: Number(target.targetId), message: segments })
      return await this.client.call('send_private_msg', { user_id: Number(target.targetId), message: segments })
    } catch (err) {
      this.logger.warn?.('[qqbot-refine] 发送失败：' + errMsg(err))
      return undefined
    }
  }

  async textOut(method, target, text) {
    const r = await this.outbound(method, [target, String(text ?? '')])
    if (r.block) return
    const finalText = String(r.args?.[1] ?? '')
    if (!finalText.trim()) return
    return this.rawSend(target, [{ type: 'text', data: { text: finalText } }])
  }

  sendText(target, text) { return this.textOut('sendText', target, text) }

  sendMarkdown(target, text) { return this.textOut('sendMarkdown', target, text) }

  async sendImage(target, src) {
    const r = await this.outbound('sendImage', [target, src])
    if (r.block) return
    const s = r.args?.[1]
    const file = asFileUri(typeof s === 'string' ? s : s?.url || s?.localPath)
    if (!file) return
    return this.rawSend(target, [{ type: 'image', data: { file } }])
  }

  async sendVoice(target, src) {
    const r = await this.outbound('sendVoice', [target, src])
    if (r.block) return
    const s = r.args?.[1]
    let file = ''
    if (s?.buffer) file = 'base64://' + Buffer.from(s.buffer).toString('base64')
    else file = asFileUri(s?.localPath ?? s?.url ?? s)
    if (!file) return
    return this.rawSend(target, [{ type: 'record', data: { file } }])
  }

  async sendVideo(target, src) {
    const r = await this.outbound('sendVideo', [target, src])
    if (r.block) return
    const s = r.args?.[1]
    const file = asFileUri(typeof s === 'string' ? s : s?.localPath ?? s?.url)
    if (!file) return
    return this.rawSend(target, [{ type: 'video', data: { file } }])
  }

  async sendFile(target, src, opts = {}) {
    const r = await this.outbound('sendFile', [target, src, opts])
    if (r.block) return
    const s = r.args?.[1]
    const localPath = typeof s === 'string' ? s : s?.localPath ?? ''
    if (!localPath) return
    const name = opts?.name || localPath.split(/[\\/]/).pop() || 'file'
    try {
      if (target?.scope === 'group') {
        return await this.client.call('upload_group_file', { group_id: Number(target.targetId), file: localPath, name })
      }
      return await this.client.call('upload_private_file', { user_id: Number(target.targetId), file: localPath, name })
    } catch (err) {
      this.logger.warn?.('[qqbot-refine] 文件上传失败：' + errMsg(err))
      return undefined
    }
  }
}

/**
 * 通道本体：事件 → 闸门 → agent；session 事件 → OneBot 发送
 */
export class OneBotChannel {
  constructor({ ctx, gate, client, logger = console, getConfig = loadConfig }) {
    this.ctx = ctx
    this.gate = gate
    this.client = client
    this.logger = logger
    this.getConfig = getConfig
    this.chats = new Map()
    this.bySession = new Map()
    this.pending = new Map()
    this.recent = new Map()
    this.joinedPreset = ''
    this.counts = { inbound: 0, dispatched: 0, blocked: 0, replied: 0, dropped: 0, errors: 0 }
    this.selfId = null
    this.bot = new OneBotBot({ client, gate, logger, selfId: () => this.selfId })
    this.offEvent = null
    this.offSession = null
    this.started = false
  }

  service(name) {
    try {
      const direct = this.ctx?.get?.(name)
      if (direct) return direct
    } catch { /* 换根上下文再试一次 */ }
    try { return this.ctx?.root?.get?.(name) ?? null } catch { return null }
  }

  start() {
    if (this.started) return true
    this.started = true
    this.offEvent = this.client.onEvent((ev) => { void this.handleEvent(ev) })
    // session 事件总线（宿主）：assistant/message → 发回 QQ
    try {
      this.offSession = this.ctx?.on?.('session/event', (session, event) => this.onSessionEvent(session, event)) ?? null
    } catch (err) {
      this.logger.warn?.('[qqbot-refine] 订阅 session 事件失败：' + errMsg(err))
    }
    this.logger.info?.('[qqbot-refine] 自建 OneBot 通道已启动（不依赖其他 DSH 插件）')
    return true
  }

  stop() {
    this.started = false
    try { this.offEvent?.() } catch { /* ignore */ }
    try { this.offSession?.() } catch { /* ignore */ }
    this.offEvent = null
    this.offSession = null
    const chats = [...this.chats.values()]
    this.chats.clear()
    this.bySession.clear()
    for (const chat of chats) {
      try { chat.agent?.cancel?.({ kind: 'user' }) } catch { /* ignore */ }
      Promise.resolve(chat.handle?.dispose?.()).catch(() => { /* ignore */ })
    }
  }

  async selfAccount() {
    if (!this.selfId) {
      try { this.selfId = String((await this.client.call('get_login_info', {}, 5000))?.user_id ?? '') || null } catch { this.selfId = null }
    }
    return this.selfId
  }

  async handleEvent(ev) {
    try {
      const selfId = this.selfId ?? (await this.selfAccount())
      const norm = normalizeEvent(ev, selfId)
      if (!norm) return
      if (selfId && norm.sender === String(selfId)) return
      this.counts.inbound += 1
      if (norm.msgId) {
        if (this.recent.has(norm.msgId)) return
        this.recent.set(norm.msgId, Date.now())
        if (this.recent.size > RECENT_MSG_CAP) {
          const first = this.recent.keys().next().value
          if (first !== undefined) this.recent.delete(first)
        }
      }
      if (!norm.content && !norm.attachments.length && !norm.mentions.length) { this.counts.dropped += 1; return }
      this.rememberQuote(norm)

      const raw = { __onebot: true, ...norm, member_role: norm.role || null }
      let blocked = false
      try {
        blocked = await this.gate.onInbound(this.bot, raw)
      } catch (err) {
        this.counts.errors += 1
        this.logger.warn?.('[qqbot-refine] 入站闸门异常（已放行）：' + errMsg(err))
      }
      if (blocked) { this.counts.blocked += 1; return }

      await this.dispatch(norm)
    } catch (err) {
      this.counts.errors += 1
      this.logger.warn?.('[qqbot-refine] 入站处理失败：' + errMsg(err))
    }
  }

  async dispatch(norm) {
    let chat = null
    try {
      chat = await this.ensureChat(norm.scope, norm.peer)
    } catch (err) {
      this.counts.errors += 1
      this.counts.dropped += 1
      this.logger.warn?.('[qqbot-refine] 建会话失败：' + errMsg(err))
      this.notifyFailure(norm, errMsg(err))
      return
    }
    if (!chat) { this.counts.dropped += 1; return }
    chat.target = { scope: norm.scope, targetId: norm.peer, msgId: norm.msgId }
    chat.lastAt = Date.now()
    chat.lastSender = norm.sender
    const body = this.composeBody(norm)
    if (!body.trim()) { this.counts.dropped += 1; return }
    try {
      chat.agent.followup(buildUserMessage(body))
      this.counts.dispatched += 1
      audit('onebot.dispatch', { scope: norm.scope, peer: String(norm.peer).slice(0, 12), len: body.length })
    } catch (err) {
      this.counts.errors += 1
      this.logger.warn?.('[qqbot-refine] 投递给模型失败：' + errMsg(err))
    }
  }

  /** 建会话失败时给群里留一句（同一处 5 分钟最多一次，别刷屏） */
  notifyFailure(norm, message) {
    const key = 'fail:' + norm.scope + ':' + norm.peer
    const now = Date.now()
    const last = this.failNoticeAt?.get?.(key) ?? 0
    if (now - last < 300000) return
    if (!this.failNoticeAt) this.failNoticeAt = new Map()
    this.failNoticeAt.set(key, now)
    void this.bot.sendText({ scope: norm.scope, targetId: norm.peer, msgId: norm.msgId }, '⚠️ 这边暂时接不上话：' + String(message).slice(0, 120))
  }

  composeBody(norm) {
    let body = bodyOf(norm)
    if (norm.quoteId) {
      const quoted = this.recentQuote(norm.quoteId)
      if (quoted) body = '[引用：' + quoted + ']\n' + body
    }
    return body
  }

  recentQuote(id) {
    const chatTexts = this.quoteCache ?? (this.quoteCache = new Map())
    return chatTexts.get(String(id)) ?? ''
  }

  rememberQuote(norm) {
    if (!norm.msgId || !norm.content) return
    const cache = this.quoteCache ?? (this.quoteCache = new Map())
    cache.set(String(norm.msgId), (norm.senderName || norm.sender) + '：' + norm.content.slice(0, 80))
    if (cache.size > RECENT_MSG_CAP) {
      const first = cache.keys().next().value
      if (first !== undefined) cache.delete(first)
    }
  }

  buildSetup() {
    const presets = this.service('agentPresets')
    if (!presets || typeof presets.mount !== 'function') return undefined
    const cfg = this.getConfig?.() ?? {}
    const wanted = String(cfg?.transport?.onebot?.preset ?? '') || String(presets.defaultId ?? '')
    if (!wanted) return undefined
    this.joinedPreset = wanted
    return async (agentCtx) => {
      try { await presets.mount(agentCtx, wanted) } catch (err) {
        this.logger.warn?.('[qqbot-refine] agent preset 挂载失败（继续用宿主默认）：' + errMsg(err))
      }
    }
  }

  ensureChat(scope, peer) {
    const key = scope + ':' + peer
    const existing = this.chats.get(key)
    if (existing) return Promise.resolve(existing)
    const pending = this.pending.get(key)
    if (pending) return pending
    const creating = this.createChat(scope, peer, key).finally(() => this.pending.delete(key))
    this.pending.set(key, creating)
    return creating
  }

  async createChat(scope, peer, key) {
    const agents = this.service('agents')
    if (!agents) throw new Error('宿主没有 agents 服务，无法建会话')
    const sid = sessionIdFor(scope, peer)
    const setup = this.buildSetup()
    const cfg = this.getConfig?.() ?? {}
    const cwd = String(cfg?.transport?.onebot?.cwd ?? '') || process.cwd()
    let agent = null
    let handle = null
    const live = (() => { try { return agents.get(sid) } catch { return null } })()
    if (live) {
      agent = live
      handle = { agent: live, dispose: async () => {} }
    } else {
      try {
        const resumed = await agents.resume({ resumeSessionId: sid, ...(setup ? { setup } : {}) })
        agent = resumed.agent
        handle = resumed
        this.logger.info?.('[qqbot-refine] onebot 会话已恢复 ' + sid.slice(0, 8) + '（' + key + '）')
      } catch {
        const presetId = this.joinedPreset
        const created = await agents.create({
          sessionId: sid,
          meta: { cwd, ...(presetId ? { agentPreset: presetId } : {}) },
          ...(setup ? { setup } : {}),
        })
        agent = created.agent
        handle = created
        this.logger.info?.('[qqbot-refine] onebot 会话已创建 ' + sid.slice(0, 8) + '（' + key + '）')
      }
    }
    const realId = String(agent?.session?.id ?? sid)
    const chat = { key, scope, peer, sid: realId, agent, handle, target: null, lastAt: Date.now(), lastSender: '' }
    this.chats.set(key, chat)
    this.bySession.set(realId, chat)
    try { rememberSession(realId, peerKey(scope, peer), scope, peer) } catch { /* ignore */ }
    return chat
  }

  onSessionEvent(session, event) {
    try {
      const sid = String(session?.header?.id ?? session?.id ?? '')
      const chat = sid ? this.bySession.get(sid) : undefined
      if (!chat) return
      if (event?.type === 'assistant/message') {
        const text = textOfMessage(event.data?.message ?? event.message)
        if (text && chat.target) {
          this.counts.replied += 1
          void this.bot.sendMarkdown(chat.target, text)
        }
        return
      }
      if (event?.type === 'turn/end') {
        const reason = event.data?.reason
        if (reason?.kind === 'error' && chat.target) {
          const msg = String(reason.error?.message ?? '未知错误').slice(0, 200)
          void this.bot.sendMarkdown(chat.target, '⚠️ 运行出错：' + msg)
        }
        const sessions = this.service('sessions')
        try { void Promise.resolve(sessions?.flush?.(chat.agent?.session)).catch(() => {}) } catch { /* ignore */ }
      }
    } catch (err) {
      this.counts.errors += 1
      this.logger.warn?.('[qqbot-refine] session 事件处理失败：' + errMsg(err))
    }
  }

  describe() {
    return {
      selfHosted: true,
      sessions: this.chats.size,
      preset: this.joinedPreset,
      counts: { ...this.counts },
    }
  }
}

export function createOneBotChannel(opts) {
  return new OneBotChannel(opts)
}
