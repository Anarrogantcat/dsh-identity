/**
 * 角色：owner / admin / member / guest
 * 手动设置优先于自动识别；QQ 群主/群管通过官方接口识别并缓存 1 小时。
 */
import { join } from 'node:path'
import { readJson, writeJson, dirs } from './store.js'
import { getMemberRole } from './api.js'

const CACHE_PATH = join(dirs.root, 'roles-cache.json')
const TTL = 3600_000

let cache = null

function loadCache() {
  if (cache) return cache
  cache = readJson(CACHE_PATH, { roles: {} })
  return cache
}

let saveTimer = null
function saveSoon() {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    try { writeJson(CACHE_PATH, loadCache()) } catch { /* ignore */ }
  }, 500)
}

export function cachedRole(groupOpenid, memberOpenid) {
  const c = loadCache()
  const key = `${groupOpenid}:${memberOpenid}`
  const item = c.roles[key]
  if (!item || Date.now() - item.at > TTL) return null
  return item.role
}

export async function resolveQqRole(groupOpenid, memberOpenid) {
  const hit = cachedRole(groupOpenid, memberOpenid)
  if (hit) return hit
  try {
    const r = await getMemberRole(groupOpenid, memberOpenid)
    const role = r.ok ? r.role : 'member'
    const c = loadCache()
    c.roles[`${groupOpenid}:${memberOpenid}`] = { role, at: Date.now() }
    saveSoon()
    return role
  } catch {
    return 'member'
  }
}

/**
 * @param {object} cfg 配置
 * @param {'group'|'c2c'} scope
 * @param {string} peer 群 openid 或用户 openid
 * @param {string} sender 发送者 openid
 */
/** 把事件里带回来的角色写进缓存（全量群消息事件的 author.member_role） */
export function rememberRole(groupOpenid, memberOpenid, role) {
  if (!groupOpenid || !memberOpenid || !role) return
  if (!['owner', 'admin', 'member'].includes(role)) return
  try {
    const c = loadCache()
    c.roles[`${groupOpenid}:${memberOpenid}`] = { role, at: Date.now() }
    saveSoon()
  } catch { /* ignore */ }
}

export async function resolveRole(cfg, scope, peer, sender, qqRoleHint) {
  const owners = cfg.roles.owners ?? []
  if (owners.includes(sender)) return 'owner'
  if ((cfg.roles.admins ?? []).includes(sender)) return 'admin'
  if (scope === 'group' && cfg.roles.adminAutoFromQqOwner) {
    // 事件自带角色优先（全量群消息事件里有 author.member_role），省一次接口调用
    if (qqRoleHint) {
      // 事件自带角色 = 权威，直接采用，不再调 30QPM 的成员信息接口
      rememberRole(peer, sender, qqRoleHint)
      return (qqRoleHint === 'owner' || qqRoleHint === 'admin') ? 'admin' : 'member'
    }
    const qqRole = await resolveQqRole(peer, sender)
    if (qqRole === 'owner' || qqRole === 'admin') return 'admin'
  }
  return 'member'
}

export function isAllowedScope(cfg, scope, peer, sender) {
  if (scope === 'group') return (cfg.scope.groups ?? []).includes(peer)
  return (cfg.scope.dmUsers ?? []).includes(sender) || (cfg.roles.owners ?? []).includes(sender)
}

/** 群诊断：机器人身份 + 本群群主/管理员（面板用） */
export function roleDiagnostics(groupOpenid) {
  const c = loadCache()
  const prefix = `${groupOpenid}:`
  const members = []
  for (const [k, v] of Object.entries(c.roles ?? {})) {
    if (!k.startsWith(prefix)) continue
    if (v.role === 'owner' || v.role === 'admin') {
      members.push({ openid: k.slice(prefix.length), role: v.role, at: v.at })
    }
  }
  return { admins: members }
}

export function clearRoleCache() {
  cache = { roles: {} }
  try { writeJson(CACHE_PATH, cache) } catch { /* ignore */ }
}
