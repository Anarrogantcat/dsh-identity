/**
 * 工具调用级闸门（真·调用拦截）
 *
 * DSH 没有 tool 中间件，所以这里直接**包住 tools 服务**：
 *   · 只扫服务内部已注册的定义（数组/Map 形态），就地替换 execute
 *   · ⚠️ 不劫持 tools.register：会破坏 per-agent 注册（duplicate tool 错误）
 *
 * 判定：
 *   · 非 QQ 会话（web/其它）→ 一律放行，不影响你平时用
 *   · QQ 私聊且 peer 是 Owner → 放行
 *   · 其它 QQ 会话（群里任何人、白名单里的其他人）→ 只放行 allowlist（默认 web_search / todo_write）
 *   · 命中敏感参数（.dsh / credentials / .ssh / 绝对路径外）→ 直接拒
 *     例外：qqbot 自己的媒体目录 ~/.dsh-qqbot/media 算工作区（看图要用）
 */
import { peerOfSession } from './persona.js'
import { audit, dirs } from './store.js'
import { dayCountPass } from './state.js'
import { resolve as pathResolve, sep as pathSep, join as pathJoin } from 'node:path'
import { homedir } from 'node:os'

/** 群会话里『这一轮是谁在说话』：通道投递前写入，工具闸门据此判断 owner */
const turnRoles = new Map()
export function setTurnRole(sessionId, role) {
  if (!sessionId) return
  turnRoles.set(String(sessionId), String(role || 'member'))
  if (turnRoles.size > 500) { const k = turnRoles.keys().next().value; turnRoles.delete(k) }
}
export function turnRoleOf(sessionId) { return turnRoles.get(String(sessionId || '')) || '' }

/** 危险命令：owner 全量也不许 */
/** 危险命令黑名单（小写匹配参数文本） */
export const DANGER_PATTERNS = [
  'shutdown /s', 'shutdown -s', 'shutdown /r', 'shutdown -r', 'reboot', 'format ', 'format.com',
  'diskpart', 'bcdedit', 'mkfs', 'rd /s', 'rmdir /s', 'del /f /s', 'del /s /q', 'remove-item -recurse -force c:',
  'rm -rf /', 'rm -rf ~', 'reg delete hklm', 'reg delete hkcr', 'cipher /w', 'takeown /f', 'icacls c:',
  'netsh interface', 'vssadmin delete', 'wbadmin', 'wmic logicaldisk', 'set-mppreference -disablerealtimemonitoring',
]
export function dangerHit(text) {
  const s = String(text || '').toLowerCase()
  return DANGER_PATTERNS.find((p) => s.includes(p)) || ''
}

/** 允许访问的根目录：工作区 + 我们自己生成文件用的目录 + 用户追加 */
export function workspaceRoots(cfg) {
  const raw = [
    process.cwd(), dirs.tmp, dirs.stickers, dirs.generated, dirs.collected,
    // qqbot 官方插件的富媒体下载目录（QQ 图片/视频落在这里，看图工具要读它）
    pathJoin(homedir(), '.dsh-qqbot', 'media'),
    ...(cfg?.tools?.workspaceRoots ?? []),
  ]
  return raw.filter(Boolean).map((p) => pathResolve(String(p)).toLowerCase().replace(/[\\/]+$/, ''))
}

function insideRoots(p, roots) {
  const r = pathResolve(p).toLowerCase()
  return roots.some((root) => r === root || r.startsWith(root + pathSep) || r.startsWith(root + '/'))
}

/** 从参数里挑出像路径的字符串 */
function pathCandidates(args) {
  const out = []
  const walk = (v, depth) => {
    if (depth > 4) return
    if (typeof v === 'string') {
      const s = v.trim()
      if (s.length < 3 || s.length > 400) return
      if (/^(?:[A-Za-z]:[\\/]|\\\\|\/|~)/.test(s) || /[\\/].*[\\/]/.test(s)) out.push(s)
      return
    }
    if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); return }
    if (v && typeof v === 'object') { for (const x of Object.values(v)) walk(x, depth + 1) }
  }
  walk(args, 0)
  return out
}

/** 返回第一个越界路径（没有则 null） */
export function outsidePath(args, cfg) {
  if (cfg?.tools?.fullAccess === true || cfg?.tools?.restrictToWorkspace === false) return null
  const roots = workspaceRoots(cfg)
  for (const raw of pathCandidates(args)) {
    let p = raw
    if (p.startsWith('~')) p = p.replace(/^~/, homedir())
    if (!/^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(p)) continue // 相对路径按工作区算，放行
    if (!insideRoots(p, roots)) return p
  }
  return null
}

const DEFAULT_ALLOW = ['web_search', 'todo_write', 'ask_user_question', 'memory', 'qqbot_refine_help']
const SENSITIVE_ARG = /(\.dsh[\\/]|credentials|\.ssh[\\/]|id_rsa|\.env\b|appSecret|api[_-]?key)/i

export const toolGate = {
  installed: false,
  keys: [],
  wrapped: 0,
  blocked: 0,
  lastError: null,
}

function sessionIdOfAgent(exec) {
  const c = [
    exec?.agent?.session?.id,
    exec?.agent?.sessionId,
    exec?.session?.id,
    exec?.sessionId,
    exec?.agent?.id,
  ]
  for (const v of c) if (typeof v === 'string' && v.length >= 8) return v
  return null
}

function argsText(args) {
  try { return JSON.stringify(args ?? {}).slice(0, 4000) } catch { return '' }
}

// ── 看图闸：同一张图不重复看 + 每组每日次数上限（图片很贵）──
const IMAGE_TOOLS = new Set(['read_image', 'qqbot_describe_image'])
const IMAGE_DEDUPE_MS = 30 * 60 * 1000
const describedMap = new Map()

function imageKeyOf(txt) {
  const m = String(txt ?? '').match(/([A-Za-z]:[\\/][^"',\s]{3,}|[\w.-]+\.(?:png|jpe?g|webp|gif))/i)
  return m ? m[1].toLowerCase() : null
}

function imageGuard(name, txt, peer, cfg) {
  if (!IMAGE_TOOLS.has(name)) return null
  const now = Date.now()
  for (const [k, t] of describedMap) if (now - t > IMAGE_DEDUPE_MS) describedMap.delete(k)
  const key = imageKeyOf(txt)
  if (key && describedMap.has(key)) {
    return { allow: false, why: 'image-dupe', message: '这张图刚看过了，不用重复看。' }
  }
  const cap = Number(cfg?.tools?.imagePerGroupDay ?? 20)
  if (cap > 0) {
    const bucket = `img:${peer.scope}:${peer.peer}`
    if (!dayCountPass(bucket, cap)) {
      return { allow: false, why: 'image-quota', message: '今天看图次数到上限了，先靠文字聊吧。' }
    }
  }
  if (key) describedMap.set(key, now)
  return null
}

export function decide(def, args, exec, cfg) {
  const sid = sessionIdOfAgent(exec)
  if (!sid) return { allow: true, why: 'no-session' }
  const peer = peerOfSession(sid)
  if (!peer) return { allow: true, why: 'not-qq' } // web 会话不受影响

  const owners = cfg?.roles?.owners ?? []
  if (peer.scope === 'c2c' && owners.includes(peer.peer)) return { allow: true, why: 'owner-dm' }

  const name = String(def?.name ?? '')
  // OWNER_FULL：群里只对主人开全量（按这一轮的发言者判断）
  if (cfg?.tools?.ownerFullAccess !== false && peer.scope === 'group' && turnRoleOf(sid) === 'owner') {
    const txt0 = argsText(args)
    const bad0 = dangerHit(txt0)
    if (bad0) return { allow: false, why: 'danger', message: `工具 ${name} 被拒绝：命中危险命令（${bad0}）` }
    toolGate.ownerAllowed += 1
    audit('tools.ownerAllow', { tool: name, why: 'owner-full' })
    return { allow: true, why: 'owner-full' }
  }
  const mode = cfg?.tools?.fullAccess === true ? 'open' : (cfg?.tools?.mode || 'allowlist')
  if (mode === 'open') return { allow: true, why: 'mode-open' }

  // 工作区限制：参数里的绝对路径必须在允许的根目录内
  if (cfg?.tools?.fullAccess !== true && cfg?.tools?.restrictToWorkspace !== false) {
    const bad = outsidePath(args, cfg)
    if (bad) return { allow: false, why: 'outside-workspace', message: `工具 ${name} 被拒绝：只能访问工作区内的文件（${bad}）` }
  }

  const allowList = (cfg?.tools?.allowForMembers?.length ? cfg.tools.allowForMembers : DEFAULT_ALLOW)
  const txt = argsText(args)
  if (SENSITIVE_ARG.test(txt)) return { allow: false, why: 'sensitive-arg', message: `工具 ${name} 被拒绝：参数涉及敏感路径/凭据` }
  if (allowList.includes(name)) {
    const g = imageGuard(name, txt, peer, cfg)
    if (g) return g
    return { allow: true, why: 'allowlist' }
  }
  return { allow: false, why: 'not-allowed', message: `工具 ${name} 在 QQ 群里不可用（仅主人可用）` }
}

function looksLikeTool(o) {
  if (!o || typeof o !== "object") return false
  if (typeof o.name !== "string" || !o.name) return false
  return !!(o.parameters || o.inputSchema)   // 真正的工具定义一定有入参 schema
}

function wrapDefinition(def, getConfig, logger) {
  if (!looksLikeTool(def)) return def
  if (!def || typeof def !== 'object') return def
  const key = ['execute', 'run', 'handler'].find((k) => typeof def[k] === 'function')
  if (!key) return def
  if (def.__refineGated) return def
  const orig = def[key]

  const wrapped = async function (args, exec, ...rest) {
    try {
      const cfg = getConfig()
      const v = decide(def, args, exec, cfg)
      if (!v.allow) {
        toolGate.blocked += 1
        audit('tools.block', { tool: def.name ?? '?', why: v.why })
        logger?.warn?.(`[qqbot-refine] 工具拦截：${def.name} (${v.why})`)
        throw new Error(v.message || '该工具在此会话不可用')
      }
    } catch (err) {
      if (err instanceof Error && /不可用|被拒绝/.test(err.message)) throw err
      // 闸门自身出错一律放行，绝不因为我们的 bug 卡死工具
    }
    const t0 = Date.now()
    try {
      const result = await orig.call(def, args, exec, ...rest)
      audit('tools.call', { tool: def.name ?? '?', ok: true, ms: Date.now() - t0 })
      return result
    } catch (err) {
      audit('tools.call', { tool: def.name ?? '?', ok: false, ms: Date.now() - t0, error: String(err?.message ?? err).slice(0, 200) })
      throw err
    }
  }

  def[key] = wrapped
  def.__refineGated = true
  toolGate.wrapped += 1
  return def
}

/** 扫一遍服务内部已注册的定义（不同 DSH 版本结构不同，做防御式遍历） */
function wrapExisting(tools, getConfig, logger) {
  let n = 0
  const seen = new Set()
  const visit = (v, depth) => {
    if (!v || depth > 3 || seen.has(v)) return
    if (typeof v === 'object') seen.add(v)
    if (Array.isArray(v)) { for (const x of v) { if (x && typeof x === 'object' && (x.execute || x.run || x.handler)) { wrapDefinition(x, getConfig, logger); n += 1 } else visit(x, depth + 1) } return }
    if (v instanceof Map) { for (const x of v.values()) { if (x && typeof x === 'object' && (x.execute || x.run || x.handler)) { wrapDefinition(x, getConfig, logger); n += 1 } else visit(x, depth + 1) } return }
    for (const k of Object.keys(v)) {
      if (k.startsWith('_')) continue
      const x = v[k]
      if (x && typeof x === 'object' && (x.execute || x.run || x.handler)) { wrapDefinition(x, getConfig, logger); n += 1 }
      else visit(x, depth + 1)
    }
  }
  try { visit(tools, 0) } catch { /* ignore */ }
  return n
}

export function installToolGate({ ctx, getConfig, logger = console }) {
  try {
    const cfg0 = getConfig?.() ?? {}
    if (cfg0?.tools?.enableGate === false) { toolGate.lastError = '已关闭（enableGate=false）'; return toolGate }
    const tools = ctx?.get?.('tools') ?? ctx?.tools
    if (!tools) { toolGate.lastError = 'tools 服务不可用'; return toolGate }

    try { toolGate.keys = Object.keys(tools).slice(0, 30) } catch {}

    // 1) 已注册的（默认不包：DSH 内部对象和工具定义长得很像，盲包有风险）
    const gateExisting = cfg0?.tools?.gateExisting === true
    if (gateExisting) wrapExisting(tools, getConfig, logger)

    // 2) 不再劫持 tools.register：
    //    绑定 this 会把 per-agent 注册打回全局注册表，触发
    //    "tool \"subagent\" is already registered"。改为只对已注册定义做就地包装。

    toolGate.installed = true
    logger.info?.(`[qqbot-refine] 工具闸门已安装（已包 ${toolGate.wrapped} 个）`)
  } catch (err) {
    toolGate.lastError = String(err?.message ?? err)
    logger.warn?.(`[qqbot-refine] 工具闸门安装失败：${toolGate.lastError}`)
  }
  return toolGate
}
