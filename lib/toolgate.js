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
import { runCapability } from './caprun.js'
import { searchResults } from './draw.js'
import { latestSectionText } from './memes.js'
import './caps-default.js'
import { audit, dirs } from './store.js'
import { dayCountPass, ratePass } from './state.js'
import { spawn } from 'node:child_process'
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
const RM = 'rm -rf '
export const DANGER_PATTERNS = [
  'shutdown /s', 'shutdown -s', 'shutdown /r', 'shutdown -r', 'reboot', 'format ', 'format.com',
  'diskpart', 'bcdedit', 'mkfs', 'rd /s', 'rmdir /s', 'del /f /s', 'del /s /q', 'remove-item -recurse -force c:',
  RM + '/', RM + '~', 'reg delete hklm', 'reg delete hkcr', 'cipher /w', 'takeown /f', 'icacls c:',
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

/** MCP 工具名 mcp__wincu__windows_computer_use_click → windows_computer_use_click（白名单可以只写短名） */
export function bareToolName(name) {
  return String(name ?? '').replace(/^mcp__[A-Za-z0-9_.-]+__/, '')
}

/** dsh-computer-use-win 的工具：单独一档，默认只给「看」 */
export const COMPUTER_TOOL_RE = /^windows_computer_use_/
export const COMPUTER_READONLY = new Set([
  'windows_computer_use_health',
  'windows_computer_use_list_windows',
  'windows_computer_use_accessibility_tree',
  'windows_computer_use_screenshot',
  'windows_computer_use_ocr',
  'windows_computer_use_find',
  'windows_computer_use_element_info',
  'windows_computer_use_snapshot',
  'windows_computer_use_wait',
  'windows_computer_use_wait_for',
  'windows_computer_use_tools',
])

/** 白名单匹配：支持精确名、短名（去掉 mcp__server__）、以及结尾 * 前缀匹配 */
export function allowHit(list, name, bare) {
  for (const raw of list ?? []) {
    const s = String(raw ?? '').trim()
    if (!s) continue
    if (s === name || s === bare) return true
    if (s.endsWith('*')) {
      const p = s.slice(0, -1)
      if (name.startsWith(p) || bare.startsWith(p)) return true
    }
  }
  return false
}

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

  // 电脑操控（dsh-computer-use-win）：按 tools.computerUse 单独一档，
  // off=成员完全不许；read=只看（截图/列窗口/控件树）；full=能点能打字
  const bare = bareToolName(name)
  if (COMPUTER_TOOL_RE.test(bare)) {
    const cu = String(cfg?.tools?.computerUse ?? 'read')
    if (cu === 'off') return { allow: false, why: 'computer-use-off', message: '电脑操控没开（面板 隐私/工具 → 群成员能不能操控电脑）' }
    if (cu !== 'full' && !COMPUTER_READONLY.has(bare)) return { allow: false, why: 'computer-use-readonly', message: '现在只允许看电脑，不许点/打字（面板可切到 full）' }
    return { allow: true, why: 'computer-use:' + cu }
  }

  if (allowHit(allowList, name, bare)) {
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
  if (!looksLikeTool(def)) return false
  if (!def || typeof def !== 'object') return false
  const key = ['execute', 'run', 'handler'].find((k) => typeof def[k] === 'function')
  if (!key) return false
  if (def.__refineGated) return false
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
      const bareName = bareToolName(def.name)
      const compWrite = COMPUTER_TOOL_RE.test(bareName) && !COMPUTER_READONLY.has(bareName)
      let result
      if (compWrite) {
        // 电脑操控的写操作统一走 desktop.act 能力：策略、超时、审计一处管
        const cap = await runCapability('desktop.act', { action: bareName, execute: async () => ({ ok: true, value: await orig.call(def, args, exec, ...rest) }) }, { cfg: getConfig(), logger })
        if (!cap.ok) throw new Error('电脑操控被拦：' + (cap.error || cap.code))
        result = cap.data && 'value' in cap.data ? cap.data.value : cap.data
      } else {
        result = await orig.call(def, args, exec, ...rest)
      }
      audit('tools.call', { tool: def.name ?? '?', ok: true, ms: Date.now() - t0 })
      try { if (/^web_?search$/i.test(String(def.name ?? ''))) recordSearch(1) } catch { /* ignore */ }
      return result
    } catch (err) {
      audit('tools.call', { tool: def.name ?? '?', ok: false, ms: Date.now() - t0, error: String(err?.message ?? err).slice(0, 200) })
      throw err
    }
  }

  def[key] = wrapped
  def.__refineGated = true
  toolGate.wrapped += 1
  return true
}

/** 扫一遍服务内部已注册的定义（不同 DSH 版本结构不同，做防御式遍历） */
function wrapExisting(tools, getConfig, logger) {
  let n = 0
  const seen = new Set()
  const visit = (v, depth) => {
    if (!v || depth > 3 || seen.has(v)) return
    if (typeof v === 'object') seen.add(v)
    const take = (x) => { if (x && typeof x === 'object' && (x.execute || x.run || x.handler)) { if (wrapDefinition(x, getConfig, logger)) n += 1; return true } return false }
    if (Array.isArray(v)) { for (const x of v) { if (!take(x)) visit(x, depth + 1) } return }
    if (v instanceof Map) { for (const x of v.values()) { if (!take(x)) visit(x, depth + 1) } return }
    for (const k of Object.keys(v)) {
      if (k.startsWith('_')) continue
      if (!take(v[k])) visit(v[k], depth + 1)
    }
  }
  try { visit(tools, 0) } catch { /* ignore */ }
  return n
}

/**
 * 给一个 QQ 会话补上闸门（幂等）。
 *
 * 为什么不劫持 tools.register：那样会把 per-agent 注册打回全局注册表，触发
 * "tool 已注册"；所以改成会话建好后，扫它自己那几个工具容器，就地包 execute。
 * 找不到就返回 0，不影响会话本身。
 */
export function gateAgent(agent, getConfig, logger = console) {
  if (!agent || typeof agent !== 'object') return 0
  try {
    if ((getConfig?.() ?? {})?.tools?.enableGate === false) return 0
  } catch { /* ignore */ }
  const containers = []
  const push = (v) => { if (v && typeof v === 'object') containers.push(v) }
  push(agent.tools)
  push(agent.toolset)
  push(agent.toolRegistry)
  push(agent.session?.tools)
  push(agent.session?.toolset)
  push(agent.session?.toolRegistry)
  try { push(agent.ctx?.get?.('tools')) } catch { /* ignore */ }
  try { push(agent.context?.get?.('tools')) } catch { /* ignore */ }
  try { push(agent.session?.ctx?.get?.('tools')) } catch { /* ignore */ }
  try { push(agent.handle?.agent?.tools) } catch { /* ignore */ }
  let n = 0
  const seen = new Set()
  for (const c of containers) {
    if (seen.has(c)) continue
    seen.add(c)
    try { n += wrapExisting(c, getConfig, logger) } catch { /* ignore */ }
  }
  if (n > 0) toolGate.agentWrapped = (toolGate.agentWrapped ?? 0) + n
  // 一个都没扫到就记一笔现场，方便下次判断 DSH 这版把工具挂哪了
  if (n === 0 && !toolGate.lastShape) {
    const shape = (v) => {
      try {
        if (v == null) return String(v)
        if (typeof v !== 'object') return typeof v
        if (v instanceof Map) return 'Map(' + v.size + ')'
        return Object.keys(v).slice(0, 10)
      } catch { return '?' }
    }
    try {
      toolGate.lastShape = {
        agent: shape(agent),
        tools: shape(agent.tools),
        toolset: shape(agent.toolset),
        session: agent.session ? shape(agent.session) : null,
        sessionTools: agent.session ? shape(agent.session.tools) : null,
      }
    } catch { /* ignore */ }
  }
  return n
}

export function installToolGate({ ctx, getConfig, logger = console }) {
  try {
    const cfg0 = getConfig?.() ?? {}
    if (cfg0?.tools?.enableGate === false) { toolGate.lastError = '已关闭（enableGate=false）'; return toolGate }
    const tools = ctx?.tools ?? ctx?.get?.('tools')
    if (!tools) { toolGate.lastError = 'tools 服务不可用'; return toolGate }

    try { toolGate.keys = Object.keys(tools).slice(0, 30) } catch {}
    // 自检：这版 DSH 的工具注册表长什么样（list / get / register / restrict / guard…）
    try {
      const fns = []
      for (const k of ['list', 'all', 'get', 'register', 'restrict', 'guard', 'visible', 'resolve']) {
        if (typeof tools[k] === 'function') fns.push(k)
      }
      toolGate.api = fns
      let names = null
      try {
        const raw = typeof tools.list === 'function' ? tools.list() : (typeof tools.all === 'function' ? tools.all() : null)
        if (Array.isArray(raw)) names = raw.slice(0, 40).map((x) => (typeof x === 'string' ? x : String(x?.name ?? x?.id ?? '?')))
        else if (raw && typeof raw === 'object') names = Object.keys(raw).slice(0, 40)
      } catch { /* ignore */ }
      toolGate.toolNames = names
      let probe = null
      try { probe = typeof tools.get === 'function' ? !!tools.get('web_search') : null } catch { /* ignore */ }
      toolGate.webSearchVisible = probe
    } catch { /* ignore */ }

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

/** 去掉「今天/现在/多少」这类口语词：搜「今天金价」经常直接空，搜「金价」反而有结果 */
export function simplifyQuery(q) {
  const s = String(q ?? '')
    .replace(/(今天|今日|今晚|现在|目前|最新|当前|实时|刚刚|一下|帮忙|帮我|查查|搜搜|多少|几号|怎么样|如何|呢|啊|吗|吧)/g, ' ')
    .replace(/[？?！!。，,、\s]+/g, ' ')
    .trim()
  return s.slice(0, 60)
}

/** 搜索结果 → 给模型看的几行：标题（域名）：摘要。没有具体数字也至少知道翻到了哪几家 */
export function renderSearchItems(items, maxChars = 600) {
  const lines = []
  let used = 0
  for (const it of items || []) {
    const host = (() => { try { return new URL(String(it.url || '')).host.replace(/^www\./, '') } catch { return '' } })()
    const head = host ? `${it.title}（${host}）` : it.title
    const line = '- ' + head + (it.snippet ? '：' + it.snippet : '')
    if (used + line.length > maxChars && lines.length) break
    lines.push(line)
    used += line.length + 1
  }
  return lines.join('\n')
}

/** 搜一次；空结果就换简化词再试一次，仍空返回 [] */
export async function lookupWeb(query, limit = 4, opts = {}) {
  const q = String(query ?? '').trim()
  if (!q) return []
  let items = await searchResults(q, limit, opts)
  if (items.length) return items
  const s = simplifyQuery(q)
  if (s && s !== q) items = await searchResults(s, limit, opts)
  return items
}

/**
 * 给 QQ 会话注册一个 web_search 影子工具。
 *
 * 为什么：这版 DSH 的全局工具表在 QQ 作用域里是空的（get('web_search') = undefined），
 * 宿主不会把工具塞给 agents.create 建出来的会话。scoped 注册会盖在全局之上，
 * 所以在这个会话自己的作用域注册一个，既能让模型看到，又不影响 web 会话。
 */
export function ensureSearchTool(agent, getConfig, logger = console) {
  try {
    if (!agent || agent.__identitySearchTool) return 0
    const t = agent.ctx?.tools ?? (typeof agent.ctx?.get === 'function' ? agent.ctx.get('tools') : null) ?? agent.scope?.tools
    if (!t || typeof t.register !== 'function') { toolGate.lastToolError = '会话里拿不到 tools.register'; return 0 }
    let visible = null
    try { visible = typeof t.get === 'function' ? t.get('web_search', agent) : null } catch { /* ignore */ }
    if (visible) { agent.__identitySearchTool = true; return 0 }
    const def = {
      name: 'web_search',
      description: '联网搜索。查实时信息、热搜、网络梗、新闻、比分这类当前事实时用它。返回的是网页标题+摘要（可能没有具体数字），拿不到数字就照实说没查到，别编。',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: '检索关键词，尽量短，例如「今天的热搜」' } },
        required: ['query'],
      },
      // DSH 0.2.1 的 tools.register 强制要求 output；且 schema.type 只认
      // object/array/string/number/integer/boolean/null（这版真实报错：
      // 'schema.type must be one of object/array/string/number/integer/boolean/null'）。
      // 我们的 execute 返回纯文本，所以就是 string。
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value ?? null, null, 2) }],
      },
      timeoutMs: 30000,
      execute: async (args) => {
        const cfg = getConfig?.() ?? {}
        const q = String(args?.query ?? '').trim().slice(0, 80)
        if (!q) return '（空查询）'
        // 留痕：模型到底有没有真来调（面板/审计能查，别只靠"应该会调"）
        try { audit('tools.call', { name: 'web_search', q: q.slice(0, 40) }) } catch { /* ignore */ }
        try {
          const v = decide(def, args, null, cfg)
          if (!v.allow) throw new Error(v.message || '该工具在此会话不可用')
        } catch (err) {
          if (err instanceof Error && /不可用|被拒绝/.test(err.message)) throw err
          // 闸门自己出错一律放行
        }
        const parts = []
        if (/热搜|热梗|梗/.test(q)) {
          try {
            const m = latestSectionText(400)
            if (m) {
              const lines = m.split('\n').filter((l) => l.trim().startsWith('- ')).slice(0, 6)
              if (lines.length) parts.push(lines.join('\n'))
            }
          } catch { /* ignore */ }
        }
        if (!parts.length) {
          try {
            const items = await lookupWeb(q, 4)
            const lines = renderSearchItems(items, 600)
            if (lines) parts.push(lines)
          } catch { /* 搜不到就按"没搜到"回，别抛 */ }
        }
        return parts.join('\n') || '（没搜到：可能被限流，换个关键词再试）'
      },
    }
    const dispose = t.register(def)
    agent.__identitySearchTool = dispose || true
    toolGate.registered = (toolGate.registered ?? 0) + 1
    try { audit('tools.register', { name: 'web_search', n: toolGate.registered }) } catch { /* ignore */ }
    logger?.info?.('[qqbot-refine] 已给会话注册 web_search')
    return 1
  } catch (e) {
    toolGate.lastToolError = String(e?.message ?? e).slice(0, 120)
    return 0
  }
}

/** 找 PowerShell：有 pwsh 用 pwsh，没有退回系统自带的 powershell.exe */
function shellBin() {
  return process.platform === 'win32' ? (process.env.DSH_SHELL_BIN || 'pwsh') : '/bin/sh'
}

/** 去掉终端颜色转义：模型不需要 ANSI，写进审计也难看 */
export function stripAnsi(s) {
  return String(s ?? '').replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').replace(/\r/g, '')
}

/** 跑一条命令：不经过 shell:true（避免参数被二次解析），限时、截断输出、留审计 */
export function runShellCommand(command, { timeoutMs = 20000, cwd = '' } = {}) {
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32'
    const bin = shellBin()
    // Windows 默认输出编码不是 UTF-8，中文会变乱码：先把控制台编码切到 UTF-8 再跑
    const full = isWin
      ? '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $OutputEncoding=[System.Text.Encoding]::UTF8; ' + command
      : command
    const args = isWin ? ['-NoProfile', '-NonInteractive', '-Command', full] : ['-c', full]
    const t0 = Date.now()
    let out = ''
    let err = ''
    let done = false
    let child
    const finish = (payload) => {
      if (done) return
      done = true
      try { child?.kill() } catch { /* ignore */ }
      resolve({ ...payload, out: stripAnsi(payload.out), err: stripAnsi(payload.err), ms: Date.now() - t0 })
    }
    try {
      child = spawn(bin, args, { windowsHide: true, cwd: cwd || undefined, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (e) {
      return finish({ ok: false, code: -1, out: '', err: '启动失败：' + (e?.message ?? e) })
    }
    const timer = setTimeout(() => finish({ ok: false, code: -2, out, err: err + '\n（超时，已终止）' }), Math.max(1000, timeoutMs))
    child.stdout.on('data', (b) => { if (out.length < 20000) out += String(b) })
    child.stderr.on('data', (b) => { if (err.length < 8000) err += String(b) })
    child.on('error', (e) => { clearTimeout(timer); finish({ ok: false, code: -1, out, err: '执行失败：' + (e?.message ?? e) }) })
    child.on('close', (code) => { clearTimeout(timer); finish({ ok: code === 0, code, out, err }) })
  })
}

/**
 * 给 QQ 会话注册 pwsh（主人专用、默认关闭）。
 *
 * 背景：宿主不给 QQ 会话装工具，所以宿主自己的 pwsh 在这边根本不存在。
 * 风险：开了之后，QQ 号被盗 = 这台电脑能被远程操作。所以：
 *   · 面板开关 tools.ownerShell 默认 false，关着就一律拒绝
 *   · 只主人：私聊主人，或群里这一轮说话的是主人
 *   · 危险命令黑名单照拦；不拼 shell:true；限时；输出截断；每次留审计
 */
export function shellRefusal(args, agent, getConfig) {
  const cfg = getConfig?.() ?? {}
  const sid = String(agent?.session?.id ?? '')
  const peer = sid ? peerOfSession(sid) : null
  const owners = Array.isArray(cfg?.roles?.owners) ? cfg.roles.owners : []
  const isOwner = !!peer && (peer.scope === 'c2c'
    ? owners.includes(peer.peer)
    : turnRoleOf(sid) === 'owner')
  if (!peer) return '（这里不是 QQ 会话，用宿主自己的终端就行）'
  if (!isOwner) return '（只有主人能让本鱼在这台电脑上跑命令）'
  if (cfg?.tools?.ownerShell !== true) return '（主人还没打开「允许在 QQ 里执行命令」，面板 → 隐私/工具 里可以开）'
  const cmd = String(args?.command ?? '').trim()
  if (!cmd) return '（空命令）'
  const bad = dangerHit(cmd)
  if (bad) {
    try { audit('tools.shell.deny', { why: 'danger', hit: bad }) } catch { /* ignore */ }
    return `（拒绝执行：命中危险命令「${bad}」）`
  }
  if (!ratePass('shell:' + String(peer.peer), 20, 10 * 60000)) return '（命令跑得太频繁了，歇十分钟再来）'
  return ''
}

export function ensureShellTool(agent, getConfig, logger = console) {
  try {
    if (!agent || agent.__identityShellTool) return 0
    const t = agent.ctx?.tools ?? (typeof agent.ctx?.get === 'function' ? agent.ctx.get('tools') : null) ?? agent.scope?.tools
    if (!t || typeof t.register !== 'function') return 0
    let visible = null
    try { visible = typeof t.get === 'function' ? t.get('pwsh', agent) : null } catch { /* ignore */ }
    if (visible) { agent.__identityShellTool = true; return 0 }
    const def = {
      name: 'pwsh',
      description: '在主人这台电脑上执行 PowerShell 命令（仅主人、且主人明确开启时才可用）。查内存/进程/磁盘、看日志这类排查可以直接用；改文件、装东西前先想清楚，别乱来。',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: '要执行的 PowerShell 命令' },
          timeoutMs: { type: 'integer', description: '超时毫秒，默认 20000，最多 60000' },
        },
        required: ['command'],
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value ?? null) }],
      },
      timeoutMs: 70000,
      execute: async (args) => {
        const why = shellRefusal(args, agent, getConfig)
        if (why) return why
        const cfg = getConfig?.() ?? {}
        const cmd = String(args?.command ?? '').trim()
        const timeoutMs = Math.max(1000, Math.min(60000, Number(args?.timeoutMs) || 20000))
        const r = await runShellCommand(cmd, { timeoutMs, cwd: cfg?.tools?.shellCwd || '' })
        try {
          audit('tools.shell', { cmd: cmd.slice(0, 120), code: r.code, ms: r.ms, out: String(r.out || '').slice(0, 200) })
        } catch { /* ignore */ }
        const body = (String(r.out || '').trim() || String(r.err || '').trim() || '（没有输出）').slice(0, 4000)
        return `exit=${r.code} (${r.ms}ms)\n${body}` + (String(r.out || '').length > 4000 ? '\n…（输出太长，已截断）' : '')
      },
    }
    const dispose = t.register(def)
    agent.__identityShellTool = dispose || true
    toolGate.registered = (toolGate.registered ?? 0) + 1
    try { audit('tools.register', { name: 'pwsh', n: toolGate.registered }) } catch { /* ignore */ }
    logger?.info?.('[qqbot-refine] 已给会话注册 pwsh（主人专用，面板开关默认关）')
    return 1
  } catch (e) {
    toolGate.lastShellError = String(e?.message ?? e).slice(0, 120)
    try { audit('tools.registerFail', { name: 'pwsh', error: toolGate.lastShellError }) } catch { /* ignore */ }
    return 0
  }
}
