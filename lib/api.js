/**
 * 官方 QQ 开放平台 REST 客户端（本插件独立使用，不依赖 qqbot 插件内部实例）
 * 凭证来源：环境变量 → profile 的 cordis.patch.yml（im-qqbot 行）
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { DSH_HOME } from './config.js'

const TOKEN_URL = 'https://bots.qq.com/app/getAppAccessToken'
let tokenCache = { appId: '', token: '', expiresAt: 0 }

function patchCandidates() {
  const profiles = join(DSH_HOME, 'profiles')
  const names = ['desktop', 'web']
  return names.map((n) => join(profiles, n, 'cordis.patch.yml'))
}

export function readCredentials() {
  const appIdEnv = process.env.QQBOT_APPID
  const secretEnv = process.env.QQBOT_SECRET
  if (appIdEnv && secretEnv) return { appId: appIdEnv, appSecret: secretEnv, from: 'env' }
  for (const file of patchCandidates()) {
    if (!existsSync(file)) continue
    try {
      const text = readFileSync(file, 'utf8')
      const block = text.split(/\n(?=- )/).find((b) => /id:\s*im-qqbot/.test(b)) ?? text
      const appId = block.match(/appId:\s*['"]?(\d{5,})['"]?/)?.[1]
      const secret = block.match(/appSecret:\s*['"]?([A-Za-z0-9._-]{10,})['"]?/)?.[1]
      if (appId && secret) return { appId, appSecret: secret, from: file }
    } catch { /* ignore */ }
  }
  return null
}

export async function getToken(force = false) {
  const creds = readCredentials()
  if (!creds) throw new Error('未找到 appId/appSecret')
  const now = Date.now()
  if (!force && tokenCache.token && tokenCache.appId === creds.appId && now < tokenCache.expiresAt - 60_000) {
    return tokenCache.token
  }
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ appId: creds.appId, clientSecret: creds.appSecret }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.access_token) {
    throw new Error(`取 token 失败: ${res.status} ${JSON.stringify(data).slice(0, 200)}`)
  }
  tokenCache = {
    appId: creds.appId,
    token: data.access_token,
    expiresAt: now + Number(data.expires_in ?? 7200) * 1000,
  }
  return tokenCache.token
}

export async function api(method, path, body) {
  const token = await getToken()
  const res = await fetch(`https://api.sgroup.qq.com${path}`, {
    method,
    headers: {
      authorization: `QQBot ${token}`,
      'content-type': 'application/json',
      'user-agent': 'dsh-qqbot-refine/0.2 (+https://github.com/)',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
  return { ok: res.ok, status: res.status, data }
}

/** 群成员角色：member | owner | admin（接口 30 QPM，外部请缓存） */
export async function getMemberRole(groupOpenid, memberOpenid) {
  const r = await api('GET', `/v2/groups/${groupOpenid}/members/${memberOpenid}`)
  if (!r.ok) return { ok: false, status: r.status, error: r.data?.message ?? r.data?.code ?? 'unknown' }
  return { ok: true, role: r.data?.member_role ?? 'member', name: r.data?.username ?? '' }
}

/** 机器人群内身份（文档接口，若不可用返回 null） */
export async function getBotGroupRole(groupOpenid) {
  const r = await api('GET', `/v2/groups/${groupOpenid}/bot_state`)
  if (!r.ok) return { ok: false, status: r.status, error: r.data?.message ?? r.data?.code ?? 'unknown' }
  return { ok: true, data: r.data }
}

/** 设置/解除禁言（仅普通成员可用；机器人需群管） */
export async function setMute(groupOpenid, memberOpenid, seconds) {
  const del = !seconds || seconds <= 0
  const body = { members: [{ op: del ? 'del' : 'add', member_openid: memberOpenid }] }
  if (!del) body.members[0].mute_expire_at = new Date(Date.now() + seconds * 1000).toISOString()
  const r = await api('POST', `/v2/groups/${groupOpenid}/restrict_chat_setting`, body)
  return { ok: r.ok, status: r.status, error: r.data?.message ?? r.data?.code }
}

export async function recallGroupMessage(groupOpenid, messageId) {
  const r = await api('DELETE', `/v2/groups/${groupOpenid}/messages/${messageId}`)
  return { ok: r.ok, status: r.status, error: r.data?.message ?? r.data?.code }
}
