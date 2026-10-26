/**
 * 名册：群列表 / 好友列表 / 群成员（含群名片）
 *
 * 依赖 OneBot API；官方模式能力位 roster=false → 全部跳过。
 * 缓存：<store>/roster.json（好友列表只落本地，不进提示词）
 */
import { join } from 'node:path'
import { readJson, writeJson, dirs, audit } from './store.js'
import { has, modeOf } from './capabilities.js'

const PATH = join(dirs.root, 'roster.json')

function empty() {
  return { updatedAt: 0, self: null, groups: [], friends: [], members: {} }
}

export function loadRoster() {
  const j = readJson(PATH, null)
  if (!j || typeof j !== 'object') return empty()
  return { ...empty(), ...j, members: j.members ?? {} }
}

export function saveRoster(r) {
  writeJson(PATH, r)
}

const now = () => Date.now()

/** 刷新群列表 + 好友列表（节流由调用方控制） */
export async function refreshAll(client, cfg) {
  if (!has('roster', cfg)) return { ok: false, error: '当前模式不支持名册' }
  const r = loadRoster()
  try {
    const groups = await client.call('get_group_list', {})
    r.groups = (groups ?? []).map((g) => ({ id: g.group_id, name: g.group_name ?? '', count: g.member_count ?? 0, max: g.max_member_count ?? 0 }))
  } catch (err) { return { ok: false, error: '群列表失败: ' + String(err?.message ?? err) } }
  try {
    const friends = await client.call('get_friend_list', {})
    r.friends = (friends ?? []).map((f) => ({ id: f.user_id, nickname: f.nickname ?? '', remark: f.remark ?? '' }))
  } catch (err) { r.friends = r.friends ?? [] }
  r.updatedAt = now()
  saveRoster(r)
  try { audit('roster.refresh', { groups: r.groups.length, friends: r.friends.length }) } catch { /* ignore */ }
  return { ok: true, groups: r.groups.length, friends: r.friends.length }
}

/** 刷新某群成员（含群名片与角色） */
export async function refreshMembers(client, groupId, cfg) {
  if (!has('roster', cfg)) return { ok: false, error: '当前模式不支持名册' }
  const r = loadRoster()
  try {
    const list = await client.call('get_group_member_list', { group_id: Number(groupId) })
    r.members[String(groupId)] = {
      updatedAt: now(),
      list: (list ?? []).map((m) => ({ id: m.user_id, card: m.card ?? '', nickname: m.nickname ?? '', role: m.role ?? 'member' })),
    }
    saveRoster(r)
    return { ok: true, count: r.members[String(groupId)].list.length }
  } catch (err) { return { ok: false, error: '成员列表失败: ' + String(err?.message ?? err) } }
}

export function groupName(groupId) {
  const g = loadRoster().groups.find((x) => String(x.id) === String(groupId))
  return g?.name ?? ''
}

export function memberCard(groupId, uid) {
  const m = loadRoster().members[String(groupId)]?.list?.find((x) => String(x.id) === String(uid))
  return m?.card || m?.nickname || ''
}

export function rolesOf(groupId) {
  const list = loadRoster().members[String(groupId)]?.list ?? []
  return {
    owners: list.filter((m) => m.role === 'owner').map((m) => m.id),
    admins: list.filter((m) => m.role === 'admin').map((m) => m.id),
  }
}

export function friendName(uid) {
  const f = loadRoster().friends.find((x) => String(x.id) === String(uid))
  return f?.remark || f?.nickname || ''
}

export function rosterStats() {
  const r = loadRoster()
  const members = Object.values(r.members ?? {}).reduce((n, v) => n + (v?.list?.length ?? 0), 0)
  return {
    updatedAt: r.updatedAt,
    groups: r.groups.length,
    friends: r.friends.length,
    cachedGroups: Object.keys(r.members ?? {}).length,
    members,
    mode: modeOf(),
    supported: has('roster'),
  }
}

export function groupChoices() {
  return loadRoster().groups.map((g) => ({ id: g.id, name: g.name, count: g.count }))
}
