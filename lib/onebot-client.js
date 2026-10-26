/**
 * OneBot 11 WS 客户端（连 NapCat 的 websocketServers，例如 ws://127.0.0.1:3001）
 *
 * 只做三件事：
 *   1) 调 API（get_group_list / get_friend_list / get_group_member_list …）
 *   2) 收事件并分发给订阅者（供后续 S3 使用）
 *   3) 维护连接状态（重连、最近事件、延迟）
 *
 * 不创建 DSH 会话、不发消息（消息通道仍由 dsh-onebot 负责）。
 */

const DEFAULTS = { reconnectMin: 2000, reconnectMax: 60000, callTimeout: 10000 }

export class OneBotClient {
  constructor(opts = {}) {
    this.url = opts.url ?? ''
    this.token = opts.token ?? ''
    this.logger = opts.logger ?? console
    this.options = { ...DEFAULTS, ...(opts.options ?? {}) }
    this.ws = null
    this.connected = false
    this.reconnects = 0
    this.lastEventAt = 0
    this.lastError = ''
    this.self = null
    this.lastLatency = null
    this.pending = new Map()
    this.seq = 0
    this.handlers = new Set()
    this.retryTimer = null
    this.retryDelay = this.options.reconnectMin
    this.stopped = false
  }

  onEvent(fn) { this.handlers.add(fn); return () => this.handlers.delete(fn) }

  start() {
    if (!this.url) { this.lastError = '未配置 WS 地址'; return false }
    if (this.stopped) return false
    try {
      const W = globalThis.WebSocket
      if (!W) { this.lastError = '当前 Node 不支持 WebSocket（需 22+）'; return false }
      const headers = this.token ? { Authorization: 'Bearer ' + this.token } : undefined
      this.ws = headers ? new W(this.url, { headers }) : new W(this.url)
      this.ws.onopen = () => {
        this.connected = true
        this.retryDelay = this.options.reconnectMin
        this.logger?.info?.('[refine] onebot 已连接 ' + this.url)
        this.call('get_login_info', {}).then((d) => { this.self = { uin: d?.user_id ?? null, nickname: d?.nickname ?? '' } }).catch(() => {})
      }
      this.ws.onmessage = (ev) => this._onMessage(ev)
      this.ws.onerror = (ev) => { this.lastError = String(ev?.message ?? 'ws error').slice(0, 120) }
      this.ws.onclose = () => {
        this.connected = false
        this.ws = null
        for (const [, p] of this.pending) p.reject(new Error('连接已断开'))
        this.pending.clear()
        if (!this.stopped) this._scheduleReconnect()
      }
      return true
    } catch (err) {
      this.lastError = String(err?.message ?? err).slice(0, 120)
      return false
    }
  }

  _scheduleReconnect() {
    this.reconnects += 1
    const delay = this.retryDelay
    this.retryDelay = Math.min(this.options.reconnectMax, Math.round(this.retryDelay * 1.6))
    clearTimeout(this.retryTimer)
    this.retryTimer = setTimeout(() => this.start(), delay)
    this.retryTimer.unref?.()
  }

  stop() {
    this.stopped = true
    clearTimeout(this.retryTimer)
    try { this.ws?.close() } catch { /* ignore */ }
    this.ws = null
    this.connected = false
  }

  _onMessage(ev) {
    let data = null
    try { data = JSON.parse(typeof ev.data === 'string' ? ev.data : '') } catch { return }
    if (!data || typeof data !== 'object') return
    if (data.echo != null && this.pending.has(data.echo)) {
      const p = this.pending.get(data.echo)
      this.pending.delete(data.echo)
      if (data.status === 'failed' || data.retcode) p.reject(new Error(data.message || data.wording || 'API 失败'))
      else p.resolve(data.data)
      return
    }
    if (data.post_type) {
      this.lastEventAt = Date.now()
      for (const fn of this.handlers) { try { fn(data) } catch { /* ignore */ } }
    }
  }

  call(action, params = {}, timeoutMs) {
    if (!this.connected || !this.ws) return Promise.reject(new Error('onebot 未连接'))
    const echo = 'r' + (++this.seq)
    const payload = JSON.stringify({ action, params, echo })
    const timeout = timeoutMs ?? this.options.callTimeout
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(echo); reject(new Error('API 超时: ' + action)) }, timeout)
      timer.unref?.()
      this.pending.set(echo, {
        resolve: (v) => { clearTimeout(timer); resolve(v) },
        reject: (e) => { clearTimeout(timer); reject(e) },
      })
      try { this.ws.send(payload) } catch (err) { this.pending.delete(echo); clearTimeout(timer); reject(err) }
    })
  }

  async ping() {
    const t0 = Date.now()
    try {
      await this.call('get_status', {}, 5000)
      this.lastLatency = Date.now() - t0
      return this.lastLatency
    } catch {
      this.lastLatency = null
      return null
    }
  }

  describe() {
    return {
      connected: this.connected,
      endpoint: this.url,
      account: this.self,
      lastEventAt: this.lastEventAt,
      reconnects: this.reconnects,
      latencyMs: this.lastLatency,
      lastError: this.lastError,
    }
  }
}
