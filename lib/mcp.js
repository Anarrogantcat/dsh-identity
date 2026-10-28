/**
 * MCP 可选层（L4）：接入外部 MCP 服务器（手机 GAgent / B站认知 / 小黑盒…）
 *
 * 原则：
 *   · 默认关；只连配置里显式列出的 HTTP 服务器（不扫本地、不自动发现）
 *   · 工具返回一律当不可信文本：只摘抄，不当指令
 *   · 走能力运行时（policyKey=tool.read）+ 超时 + 审计；模型不能自己开服务器
 *   · 失败返回结构化 code，不抛给聊天层
 */
import { audit } from './store.js'

let seq = 0

function serversOf(cfg) {
  const raw = cfg?.mcp?.servers
  return Array.isArray(raw) ? raw.filter((s) => s && s.enabled !== false && s.id && s.url) : []
}

export function listServers(cfg) {
  return serversOf(cfg).map((s) => ({ id: String(s.id), url: String(s.url).slice(0, 80) }))
}

async function rpc(cfg, server, method, params, timeoutMs = 15000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), Math.max(1000, Number(timeoutMs) || 15000))
  try {
    const res = await fetch(server.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(server.token ? { authorization: 'Bearer ' + server.token } : {}) },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'dsh' + (++seq), method, params }),
      signal: ctrl.signal,
    })
    if (!res.ok) return { ok: false, code: 'mcp_http_' + res.status, error: 'HTTP ' + res.status }
    const j = await res.json().catch(() => null)
    if (!j) return { ok: false, code: 'mcp_bad_json', error: '返回不是 JSON' }
    if (j.error) return { ok: false, code: 'mcp_error', error: String(j.error?.message ?? j.error).slice(0, 200) }
    return { ok: true, data: j.result }
  } catch (err) {
    const code = err?.name === 'AbortError' ? 'mcp_timeout' : 'mcp_unreachable'
    return { ok: false, code, error: String(err?.message ?? err).slice(0, 160) }
  } finally {
    clearTimeout(t)
  }
}

export async function listTools(cfg, serverId, opts = {}) {
  if (cfg?.mcp?.enabled !== true) return { ok: false, code: 'mcp_disabled', error: 'MCP 没开（配置 mcp.enabled）' }
  const server = serversOf(cfg).find((s) => String(s.id) === String(serverId))
  if (!server) return { ok: false, code: 'mcp_no_server', error: '没有这个 MCP 服务器' }
  const r = await rpc(cfg, server, 'tools/list', {}, opts.timeoutMs)
  if (!r.ok) { audit('mcp.fail', { server: String(serverId), code: r.code }); return r }
  return { ok: true, tools: Array.isArray(r.data?.tools) ? r.data.tools : [] }
}

export async function callTool(cfg, serverId, tool, args = {}, opts = {}) {
  if (cfg?.mcp?.enabled !== true) return { ok: false, code: 'mcp_disabled', error: 'MCP 没开（配置 mcp.enabled）' }
  const server = serversOf(cfg).find((s) => String(s.id) === String(serverId))
  if (!server) return { ok: false, code: 'mcp_no_server', error: '没有这个 MCP 服务器' }
  const name = String(tool ?? '').trim()
  if (!name) return { ok: false, code: 'mcp_no_tool', error: '缺少工具名' }
  const r = await rpc(cfg, server, 'tools/call', { name, arguments: args ?? {} }, opts.timeoutMs)
  if (!r.ok) { audit('mcp.fail', { server: String(serverId), tool: name, code: r.code }); return r }
  // 输出只摘文本，全部当不可信
  const content = Array.isArray(r.data?.content) ? r.data.content : []
  const text = content.filter((c) => c && c.type === 'text').map((c) => String(c.text ?? '')).join('\n').slice(0, 4000)
  audit('mcp.call', { server: String(serverId), tool: name.slice(0, 40), ok: true })
  return { ok: true, text: text || JSON.stringify(r.data).slice(0, 2000) }
}
