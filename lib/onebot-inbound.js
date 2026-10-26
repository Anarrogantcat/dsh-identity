/**
 * OneBot 非消息事件（S3 入站能力）
 *
 *   notice: group_recall / friend_recall / notify(poke|honor) / group_card /
 *           group_increase / group_decrease / group_admin / group_ban / group_reaction
 *   meta_event: heartbeat / lifecycle
 *
 * 这里只做「看懂 + 判类型 + 转成动作参数」，真正的动作由 onebot-channel 执行，
 * 方便单测（纯函数，不连网）。
 */

/** 事件分类：返回 { kind, groupId, uid, msgId, targetId, raw } 或 null */
export function classifyNotice(ev) {
  if (!ev || ev.post_type !== 'notice') return null
  const t = String(ev.notice_type ?? '')
  const groupId = ev.group_id != null ? String(ev.group_id) : ''
  const uid = String(ev.user_id ?? ev.operator_id ?? '')
  const msgId = String(ev.message_id ?? '')
  if (t === 'group_recall' || t === 'friend_recall') {
    return { kind: 'recall', groupId, uid, msgId, operatorId: String(ev.operator_id ?? ''), raw: ev }
  }
  if (t === 'group_increase') return { kind: 'member_join', groupId, uid, raw: ev }
  if (t === 'group_decrease') {
    const self = String(ev.user_id ?? '') === String(ev.self_id ?? '')
    return { kind: self ? 'self_leave' : 'member_leave', groupId, uid, sub: String(ev.sub_type ?? ''), raw: ev }
  }
  if (t === 'group_ban') {
    return { kind: 'ban', groupId, uid, operatorId: String(ev.operator_id ?? ''), duration: Number(ev.duration ?? 0), raw: ev }
  }
  if (t === 'group_admin') return { kind: 'admin_change', groupId, uid, sub: String(ev.sub_type ?? ''), raw: ev }
  if (t === 'group_card') return { kind: 'card_change', groupId, uid, cardNew: String(ev.card_new ?? ''), raw: ev }
  if (t === 'group_reaction' || t === 'reaction') {
    return { kind: 'reaction', groupId, uid, msgId, code: String(ev.code ?? ''), count: Number(ev.count ?? 1), raw: ev }
  }
  if (t === 'notify') {
    const sub = String(ev.sub_type ?? '')
    if (sub === 'poke') {
      const target = String(ev.target_id ?? ev.user_id ?? '')
      return { kind: 'poke', groupId, uid, targetId: target, raw: ev }
    }
    if (sub === 'honor') return { kind: 'honor', groupId, uid, honor: String(ev.honor_type ?? ''), raw: ev }
    return { kind: 'notify_other', groupId, uid, sub, raw: ev }
  }
  return { kind: 'other', groupId, uid, noticeType: t, raw: ev }
}

/** 合并转发的内容树 → 纯文本（QQ 的合并转发是嵌套 node 结构） */
export function flattenForward(payload, limit = 20) {
  const lines = []
  const nodeOf = (n) => n?.data ?? n ?? {}
  const senderName = (n) => {
    const s = n?.sender ?? {}
    return String(s.card || s.nickname || s.user_id || '').trim()
  }
  const textOf = (content) => {
    if (typeof content === 'string') return content
    if (!Array.isArray(content)) return ''
    const out = []
    for (const seg of content) {
      if (seg?.type === 'text') out.push(String(seg.data?.text ?? ''))
      else if (seg?.type === 'image') out.push('[图片]')
      else if (seg?.type === 'face') out.push('[表情]')
      else if (seg?.type === 'at') out.push('@' + String(seg.data?.name || seg.data?.qq || ''))
    }
    return out.join('')
  }
  const walk = (n, depth) => {
    if (!n || lines.length >= limit || depth > 4) return
    if (Array.isArray(n?.messages)) { for (const c of n.messages) walk(c, depth + 1); return }
    const d = nodeOf(n)
    const content = d.content ?? d.message
    if (Array.isArray(content) || typeof content === 'string') {
      const name = senderName(d) || '某人'
      const body = textOf(content).trim()
      if (body) lines.push(name + '：' + body.slice(0, 160))
      return
    }
    if (Array.isArray(d.messages)) { for (const c of d.messages) walk(c, depth + 1) }
  }
  walk(payload, 0)
  if (!lines.length) return ''
  const more = lines.length >= limit ? '\n…（更多内容略）' : ''
  return '[合并转发]\n' + lines.join('\n') + more
}

/** 戳一戳的回应文本（不花 token，按概率回一句） */
export const POKE_REPLIES = ['别戳啦，痒……', '干嘛呀？', '在呢在呢。', '再戳就把你的白饭吃掉。', '嗯？找我？']

export function pickPokeReply(rand = Math.random) {
  const i = Math.floor(rand() * POKE_REPLIES.length) % POKE_REPLIES.length
  return POKE_REPLIES[i]
}

/** 撤回事件是否值得处理：自己撤回自己的不记、别人撤回才有信息量 */
export function shouldRecordRecall(info, selfId) {
  if (!info || info.kind !== 'recall') return false
  if (!info.msgId) return false
  if (selfId && info.operatorId === String(selfId) && String(info.uid) === String(selfId)) return false
  return true
}
