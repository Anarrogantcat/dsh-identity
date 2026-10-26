/**
 * 群管 / 互动动作（S4 出站能力）：OneBot 版实现
 *
 * 官方通道那几个动作在 api.js 里（setMute/recallGroupMessage），这里只写 OneBot 侧，
 * 每个动作都先过能力位（官方模式直接跳过并记 audit），失败返回 {ok:false,error} 不抛。
 */
import { has, modeOf } from './capabilities.js'
import { loadConfig } from './config.js'
import { audit } from './store.js'

const errText = (err) => String(err?.message ?? err).slice(0, 160)

/** 这些动作全是 OneBot 原生 API：官方通道要用 api.js 那套，别走到这里 */
function guard(cap, cfg) {
  const c = cfg ?? (() => { try { return loadConfig() } catch { return {} } })()
  const mode = modeOf(c)
  if (mode !== 'onebot') {
    try { audit('capability.skip', { cap, op: 'admin', mode }) } catch { /* ignore */ }
    return '这条通道不支持该操作（需要 onebot 模式）'
  }
  if (has(cap, c)) return null
  try { audit('capability.skip', { cap, op: 'admin', mode }) } catch { /* ignore */ }
  return '当前通道不支持该操作（' + cap + '）'
}

async function call(client, action, params) {
  if (!client) return { ok: false, error: '没有 OneBot 连接' }
  if (typeof client.connected === 'boolean' && !client.connected) return { ok: false, error: 'OneBot 未连接' }
  try {
    await client.call(action, params, 8000)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: errText(err) }
  }
}

const num = (v) => Number(v)

/** 禁言某个群成员（秒；0 = 解除） */
export async function mute(client, groupId, uid, seconds) {
  const g = guard('groupAdmin')
  if (g) return { ok: false, error: g }
  const sec = Math.max(0, Math.min(30 * 24 * 3600, Math.round(num(seconds) || 0)))
  const r = await call(client, 'set_group_ban', { group_id: num(groupId), user_id: num(uid), duration: sec })
  try { audit('admin.mute', { group: groupId, uid, sec, ok: r.ok }) } catch { /* ignore */ }
  return r
}

export function unmute(client, groupId, uid) {
  return mute(client, groupId, uid, 0)
}

/** 踢人（默认不再接受该用户加群申请） */
export async function kick(client, groupId, uid, rejectAdd = true) {
  const g = guard('groupAdmin')
  if (g) return { ok: false, error: g }
  const r = await call(client, 'set_group_kick', { group_id: num(groupId), user_id: num(uid), reject_add_request: !!rejectAdd })
  try { audit('admin.kick', { group: groupId, uid, reject: !!rejectAdd, ok: r.ok }) } catch { /* ignore */ }
  return r
}

/** 撤回消息（OneBot 用 delete_msg，按消息 id 撤，不需要群号） */
export async function recall(client, msgId) {
  const g = guard('groupAdmin')
  if (g) return { ok: false, error: g }
  const r = await call(client, 'delete_msg', { message_id: num(msgId) })
  try { audit('admin.recall', { msgId, ok: r.ok }) } catch { /* ignore */ }
  return r
}

/** 改群名片 */
export async function setCard(client, groupId, uid, card) {
  const g = guard('groupAdmin')
  if (g) return { ok: false, error: g }
  return call(client, 'set_group_card', { group_id: num(groupId), user_id: num(uid), card: String(card ?? '').slice(0, 60) })
}

/** 贴表情回应（NapCat: set_msg_emoji_like；默认 76 = 点赞） */
export async function react(client, msgId, code = 76) {
  const g = guard('reactionEvent')
  if (g) return { ok: false, error: g }
  const r = await call(client, 'set_msg_emoji_like', { message_id: num(msgId), emoji_id: String(code), set: true })
  try { audit('admin.react', { msgId, code, ok: r.ok }) } catch { /* ignore */ }
  return r
}

/** 戳一戳（群聊/私聊都支持） */
export async function poke(client, scope, groupId, uid) {
  const g = guard('pokeEvent')
  if (g) return { ok: false, error: g }
  if (scope === 'group') return call(client, 'send_group_poke', { group_id: num(groupId), user_id: num(uid) })
  return call(client, 'friend_poke', { user_id: num(uid) })
}

/** 设精华（顺手用得上） */
export async function setEssence(client, msgId) {
  const g = guard('groupAdmin')
  if (g) return { ok: false, error: g }
  return call(client, 'set_essence_msg', { message_id: num(msgId) })
}

/** 群公告 */
export async function announce(client, groupId, content) {
  const g = guard('groupAdmin')
  if (g) return { ok: false, error: g }
  return call(client, '_send_group_notice', { group_id: num(groupId), content: String(content ?? '').slice(0, 500) })
}
