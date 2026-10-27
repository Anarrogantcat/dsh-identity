/**
 * dsh-qqbot-refine —— QQ 机器人增强插件
 * 频率 / 隐私 / 人格 / 记忆(半衰期) / 画像 / 表情包 / 层级 / 群秩序 / B站
 *
 * 协议：DSH 插件（cordis）—— dsh.bundle.patch 插入条目 + webServer 面板；
 *      不改宿主、不改第三方插件源码，全部走运行时钩子，失败即降级放行。
 */

import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { DEFAULTS, FIELDS, TABS, FIELD_MAP, CFG_PATH, STORE_DIR, loadConfig, saveConfig, ensureStore, clone, coerce, setAt } from './lib/config.js'
import { ensureDirs, readJson, writeJson, dirs, peerKey, audit } from './lib/store.js'
import { diag, loadQQBot, installHooks } from './lib/diag.js'
import { startTransport, stopTransport, transportDescribe, getOneBotClient } from './lib/transport.js'
import { capabilitySummary } from './lib/capabilities.js'
import { refreshAll, refreshMembers, rosterStats, groupChoices, groupName, loadRoster } from './lib/roster.js'
import { loadState, state, newBind, getBind, clearBind } from './lib/state.js'
import { createGate, startJobs } from './lib/gate.js'
import { loadCognition, createHooks, cognitionText, consolidatePeers } from './lib/hooks.js'
import { probeService as probeVoice, lastJobInfo } from './lib/voice.js'
import { assetStatus, progressOf, downloadAsset, removeAsset, sttAutoCommand, downloadsStats } from './lib/downloads.js'
import { usageReport } from './lib/usage.js'
import { syncFromApi as syncEsports, loadCache as esportsCache, dayMatches } from './lib/esports.js'
import { resolveRoute, withRoute } from './lib/llmroute.js'
import { dataPointer, STORE_DIR as DATA_DIR } from './lib/config.js'
import { memoryCard, listMemory, forgetMemory, pinMemory, prunePeer, takePendingRecall, recall } from './lib/memory.js'
import { personaFor, sessionIdOfContext, peerOfSession, scaleBlock } from './lib/persona.js'
import { readMood, moodToneOf, moodSummary, moodBlock } from './lib/mood.js'
import { llmStats } from './lib/moodllm.js'
import { knowledgeBlock, lastQueryOf, kbStats, listKbFiles, readKbFile, saveKbFile, deleteKbFile, kbNameForPeer, importKbFromPath } from './lib/knowledge.js'
import { topicBlock, topicStats } from './lib/topic.js'
import { matchStats } from './lib/esports.js'
import { rulesFor as learnRulesFor, learnStats, learnView } from './lib/learn.js'
import { listPresets, getPresetText, savePreset, deletePreset, togglePreset, setCurrent, setScope } from './lib/presets.js'
import { gearValues, GEARS } from './lib/gear.js'
import { roleDiagnostics, clearRoleCache } from './lib/roles.js'
import * as sticker from './lib/sticker.js'
import * as bili from './lib/bili.js'
import * as profile from './lib/profile.js'
import * as mgmt from './lib/mgmt.js'
import { installToolGate, toolGate } from './lib/toolgate.js'
import { PERM_LEVELS, levelOf } from './lib/permgear.js'

export const name = 'qqbot-refine'
export const inject = ['webServer']

const HERE = dirname(fileURLToPath(import.meta.url))
const PANEL_PATH = join(HERE, 'panel.html')
const PANEL_PATHNAME = '/qqbot-refine'
const API_STATE = '/api/qqbot-refine/state'
const API_CONFIG = '/api/qqbot-refine/config'
const API_ACTION = '/api/qqbot-refine/action'

let botRef = null
let llmRef = null
let stopJobs = null
let modsRef = null
/** 宿主的 agentDefaultModel 服务（拿「默认用哪个模型」） */
let defaultModelSvc = null
/** 宿主可用的 agent 预设（QQ 会话最好选一个纯聊天的） */
let agentPresetList = null

/** QQ 群聊模式的硬约束：抵消宿主「编程 agent」提示词带来的助理腔 */
const CHAT_MODE_TEXT = [
  '你现在是在 QQ 群/私聊里聊天，不是在执行编码任务。',
  '宿主给你的开发环境说明、技能目录、沙箱、工作目录、工具清单都与你此刻无关：不要提它们，也不要用它们的口吻说话。',
  '禁止助理腔：不说「收到」「好的」「明白」「已记录」「需要我帮忙吗」「希望对你有帮助」。',
  '一次只回一两句人话；接不下去就吐槽或反问一句；对方只发了个表情时不要接。',
].join('\n')
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

function isLoopback(req) {
  const addr = req.socket?.remoteAddress ?? ''
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1'
}
function sendJson(res, status, body) {
  const data = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(data) })
  res.end(data)
}
async function readBody(req, limit = 512 * 1024) {
  let size = 0
  const chunks = []
  for await (const c of req) {
    size += c.length
    if (size > limit) throw new Error('body too large')
    chunks.push(c)
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
}

/** 记忆注入：只对 QQ 会话生效 */
function memorySectionText(context) {
  try {
    const cfg = loadConfig()
    if (!cfg.memory.enabled) return ''
    const sid = sessionIdOfContext(context)
    const peer = sid ? peerOfSession(sid) : null
    if (!peer) return ''
    let card = memoryCard(peer.peerKey, cfg)
    const q = takePendingRecall(peer.peerKey)
    if (q) {
      const hits = recall(peer.peerKey, q, cfg, cfg.memory.recallTop ?? 5)
      if (hits.length) card += `\n\n# 补充回忆（关键词：${q}）\n` + hits.map((h) => `- [${String(h.at).slice(0, 10)}] ${h.text}`).join('\n')
    }
    return card
  } catch (err) {
    try { console.warn('[qqbot-refine] memory section 失败:', err?.message) } catch {}
    return ''
  }
}
function profileSectionText(context) {
  try {
    const cfg = loadConfig()
    if (!cfg.profile.enabled) return ''
    const sid = sessionIdOfContext(context)
    const peer = sid ? peerOfSession(sid) : null
    if (!peer || peer.scope !== 'group') return ''
    return profile.speedCard(peer.peer, cfg)
  } catch (err) {
    try { console.warn('[qqbot-refine] profile section 失败:', err?.message) } catch {}
    return ''
  }
}
function personaSectionText(context) {
  try {
    const cfg = loadConfig()
    if (!cfg.persona.enabled) return ''
    const sid = sessionIdOfContext(context)
    const peer = sid ? peerOfSession(sid) : null
    if (!peer) return ''
    const p = personaFor(cfg, peer.scope, peer.peer)
    let body = p?.text ?? ''
    // 聊天尺度（滑条）：低=克制，高=更放得开
    try { if (body) body += scaleBlock(cfg.persona?.scale ?? 50) } catch { /* ignore */ }

    // 心情 → 语气（只给数值和一句建议，不带主会话里聊过的具体事）
    if (body && cfg.integration?.linkMood !== false && cfg.integration?.moodInPrompt !== false) {
      const tone = moodToneOf(readMood(cfg))
      if (tone) body += moodBlock(tone)
    }
    // 学到的规矩（Owner/管理员教的，最多 5 条）
    if (body && cfg.learn?.enabled !== false && cfg.learn?.injectRules !== false) {
      try {
        const rules = learnRulesFor(peer.peerKey, 5)
        if (rules.length) body += `

# 这个群学到的规矩（照做，别念出来）
${rules.map((r, i) => `${i + 1}. ${r}`).join('\n')}`
      } catch { /* ignore */ }
    }
    // 群知识库：按「最近一条消息」检索，命中才注入（0 token 检索）
    if (body && cfg.knowledge?.enabled !== false) {
      try {
        const q = lastQueryOf(peer.peerKey)
        if (q) body += knowledgeBlock(q, peer.peerKey, { top: 2 })
      } catch { /* ignore */ }
    }
    // 话题：这个群现在在聊哪一场（防止把历史战绩当成今天这场）
    if (body) {
      try { body += topicBlock(peer.peerKey) } catch { /* ignore */ }
    }
    // 认知四张卡 + 离线摘要（在场的人 / 说过答应过 / 还没答完的 / 群里最近在聊）
    try { body += cognitionText(mods, peer.peerKey, cfg) } catch { /* ignore */ }
    if (!body || cfg.ui?.markers === false) return body
    return body + `

# 可用标记（只写标记，不要解释）
[[sticker:auto]] 发一张表情（auto=按当前心情挑）；也可以写具体情绪，如 [[sticker:无语]]
[[remember: 要点]] 记一笔长期记忆（会淡忘，被提到会加强）
[[recall: 关键词]] 想不起旧事时让它翻记忆
[[voice: 文本]] 想让这句话用声音说出来`
  } catch (err) {
    try { console.warn('[qqbot-refine] persona section 失败:', err?.message) } catch {}
    return ''
  }
}
/** 自检：插件是不是从 node_modules 正常加载（而不是躺在 .ignored 里） */
function installInfo() {
  try {
    const here = fileURLToPath(import.meta.url)
    const inIgnored = /\\node_modules\\\.ignored\\/.test(here)
    const viaNodeModules = /\\node_modules\\dsh-qqbot-refine\\/.test(here)
    return {
      path: here,
      inIgnored,
      viaNodeModules,
      ok: !inIgnored,
      note: inIgnored
        ? '插件被包管理器隔离（.ignored）：检查 profile 的 package.json 是否声明了 file: 依赖'
        : viaNodeModules
          ? '已通过 node_modules 链接加载'
          : '从非标准路径加载（可能是直接引用源码目录）',
    }
  } catch { return { ok: true, path: '', inIgnored: false, viaNodeModules: false, note: '自检失败（已放行）' } }
}

function snapshot() {
  const cfg = loadConfig()
  return {
    ok: true,
    version: '0.9.0',
    install: installInfo(),
    stage: 'v0.9.0 · S1–S7',
    dshHome: STORE_DIR,
    configPath: CFG_PATH,
    configPathExists: existsSync(CFG_PATH),
    config: cfg,
    fields: FIELDS,
    tabs: TABS,
    diag,
    sticker: sticker.stats(),
    assets: (() => {
      try {
        const st = assetStatus(cfg)
        return { ...st, progress: progressOf(), dataDir: DATA_DIR, pointer: dataPointer(), sttAuto: sttAutoCommand(cfg) }
      } catch { return null }
    })(),
    botSeen: !!botRef,
    learn: (() => { try { return learnStats() } catch { return [] } })(),
    learnDetail: (() => {
      try {
        const view = learnView(5)
        const map = new Map()
        for (const g2 of cfg.scope?.groups ?? []) map.set(peerKey('group', g2), { scope: 'group', peer: g2 })
        for (const u of cfg.scope?.dmUsers ?? []) map.set(peerKey('c2c', u), { scope: 'c2c', peer: u })
        return view.map((v) => ({ ...v, ...(map.get(v.peerKey) ?? {}) }))
      } catch { return [] }
    })(),
    moodLlm: (() => { try { return llmStats() } catch { return null } })(),
    kb: (() => { try { return kbStats() } catch { return null } })(),
    transport: (() => { try { return transportDescribe() } catch { return null } })(),
    capabilities: (() => { try { return capabilitySummary(cfg) } catch { return null } })(),
    roster: (() => { try { return rosterStats() } catch { return null } })(),
    groupChoices: (() => { try { return groupChoices() } catch { return [] } })(),
    groupNames: (() => {
      try {
        const map = {}
        for (const g of cfg.scope?.groups ?? []) map[g] = groupName(g)
        return map
      } catch { return {} }
    })(),
    agentPresets: agentPresetList,
    profileNotices: (() => { try { const g = (loadConfig()?.scope?.groups ?? [])[0]; const list = g ? profile.noticesOf(String(g)) : []; return { count: list.length, latest: list.length ? String(list[list.length - 1].text || '') : '' } } catch (e) { return { count: 0, latest: '' } } })(),
    esports: (() => { try { const c = esportsCache(); return { at: c.at || 0, source: c.source || '', count: c.count || 0, today: dayMatches().length, errors: (c.errors || []).slice(0, 3), attempts: (c.attempts || []).slice(0, 4) } } catch (e) { return null } })(),
    mutedGroups: (() => { try { return Object.keys(state.muted ?? {}) } catch (e) { return [] } })(),
    voiceProbe: (() => { try { return (globalThis.__qqrefineVoiceProbe ?? null) } catch (e) { return null } })(),
    voiceLast: (() => { try { return lastJobInfo() } catch (e) { return null } })(),
    usage: (() => { try { return usageReport(loadConfig()) } catch (e) { return { ok: false, error: String(e && e.message || e) } } })(),
    llmRoute: (() => {
      try {
        const cfg0 = loadConfig()
        const prof = resolveRoute(defaultModelSvc, cfg0.profile?.llmProvider, cfg0.profile?.llmModel)
        const mood = resolveRoute(defaultModelSvc, cfg0.integration?.llmProvider, cfg0.integration?.llmModel)
        return { profile: prof, mood }
      } catch { return null }
    })(),
    safety: (() => {
      try {
        const m = modsRef?.safety
        if (!m) return null
        return { profile: String(loadConfig().safety?.profile ?? 'normal'), ...(m.breakerState?.() ?? {}), banned: m.bannedGroups?.() ?? [] }
      } catch { return null }
    })(),
    cognition: (() => {
      try {
        return {
          relations: modsRef?.relations?.relationsStats?.() ?? null,
          digest: modsRef?.digest?.digestStats?.() ?? null,
        }
      } catch { return null }
    })(),
    topics: (() => { try { return topicStats() } catch { return [] } })(),
    matches: (() => { try { return matchStats() } catch { return null } })(),
    mood: (() => {
      try {
        const m = readMood(cfg)
        if (!m) return null
        const tone = moodToneOf(m)
        return {
          score: m.mood,
          tone: tone?.tone ?? (m.stale ? '已过期' : '未知'),
          hint: tone?.hint ?? '',
          rules: tone?.rules ?? [],
          particles: tone?.particles ?? [],
          dims: m.dims ?? {},
          summary: moodSummary(m),
          name: m.name,
          source: m.source ?? 'plugin',
          updatedAt: m.updatedAt ?? null,
          ageHours: m.ageHours ?? null,
          stale: !!m.stale,
          lastReason: m.lastReason ?? '',
          lastSource: m.lastSource ?? '',
          mode: String(cfg.integration?.moodSource ?? 'auto'),
        }
      } catch { return null }
    })(),
    toolGate,
    gateExisting: loadConfig().tools?.gateExisting === true,
    recentPeers: state.seen ?? [],
    bind: getBind(),
    gears: GEARS,
    permLevels: PERM_LEVELS,
  }
}

export async function apply(ctx, config = {}) {
  const logger = ctx.logger ?? console
  ensureStore()
  ensureDirs()
  loadState()

  if (!existsSync(CFG_PATH)) {
    try { saveConfig(clone(DEFAULTS)) } catch { /* ignore */ }
  }

  // 认知 / 安全模块（可选；缺了插件照常跑）
  const mods = await loadCognition(logger)
  modsRef = mods
  try { defaultModelSvc = ctx.get?.('agentDefaultModel') ?? null } catch { defaultModelSvc = null }
  try {
    const ps = ctx.get?.('agentPresets')
    const list = ps?.list ? await ps.list() : null
    if (Array.isArray(list)) agentPresetList = list.map((p) => ({ id: p.id, name: p.name ?? p.id, description: p.description ?? '' }))
  } catch { agentPresetList = null }

  /** 配置里没写模型就用宿主默认；返回配置副本（不落盘） */
  const withLlmRoute = (c, section) => {
    try {
      const cur = c?.[section] ?? {}
      const route = resolveRoute(defaultModelSvc, cur.llmProvider, cur.llmModel)
      return withRoute(c, section, route)
    } catch { return c }
  }
  const hooks = createHooks({ mods, getConfig: loadConfig, logger, saveConfig })

  const gate = createGate({
    getLlm: () => llmRef,
    getConfig: loadConfig,
    saveConfig,
    diagRef: diag,
    onBot: (bot) => { botRef = bot },
    getClient: () => { try { return getOneBotClient(loadConfig()) } catch { return null } },
    resolveLlm: (c) => withLlmRoute(c, 'integration'),
    logger,
  })

  /** 定时器集合（启动时用于登记、卸载时统一清理） */
  const timers = []

  // 1) 通道（单活：tencent 或 onebot；失败降级放行）
  try {
    const tr = await startTransport(gate, logger, { ctx, hooks })
    logger.info?.(`[qqbot-refine] 通道模式=${tr.mode} 钩子=${tr.hooked ? '已挂' : '未挂'}`)
    const caps = capabilitySummary(loadConfig())
    logger.info?.(`[capability] mode=${caps.mode} 可用 ${caps.available.length}/${caps.total}` + (caps.missing.length ? ` · 缺失：${caps.missingLabels.join('/')}` : ''))
    if (tr.mode === 'onebot') {
      const cfg0 = loadConfig()
      const client = getOneBotClient(cfg0)
      if (client) {
        const tick = async () => {
          try { await refreshAll(client, loadConfig()) } catch { /* ignore */ }
          const gs = loadConfig().scope?.groups ?? []
          for (const g of gs) { try { await refreshMembers(client, g, loadConfig()) } catch { /* ignore */ } }
        }
        const t1 = setTimeout(tick, 30 * 1000); t1.unref?.()
        const hours = Math.max(1, Number(cfg0.transport?.rosterRefreshHours ?? 6))
        const t2 = setInterval(tick, hours * 3600 * 1000); t2.unref?.()
        timers.push(t1, t2)
      }
    }
  } catch (err) {
    logger.warn?.('[qqbot-refine] 通道启动失败：' + (err?.message ?? err))
  }

  // 2) 系统提示：人格 + 记忆
  if (typeof ctx.inject === 'function') {
    ctx.inject(['systemPrompt'], (scope) => {
      scope.effect(() => scope.systemPrompt.section({
        name: 'qqbot-refine:chat-mode',
        order: 10,
        interpolate: false,
        text: () => CHAT_MODE_TEXT,
      }), 'qqbot-refine: chat-mode section')
      scope.effect(() => scope.systemPrompt.section({
        name: 'qqbot-refine:persona',
        order: loadConfig().persona.order ?? 120,
        text: personaSectionText,
        interpolate: false,
      }), 'qqbot-refine: persona section')
      scope.effect(() => scope.systemPrompt.section({
        name: 'qqbot-refine:memory',
        order: 130,
        text: memorySectionText,
        interpolate: false,
      }), 'qqbot-refine: memory section')
      scope.effect(() => scope.systemPrompt.section({
        name: 'qqbot-refine:profile',
        order: 135,
        text: profileSectionText,
        interpolate: false,
      }), 'qqbot-refine: profile section')
    })
  }

  ctx.inject?.(['llm'], (s) => { try { llmRef = s.llm } catch { /* ignore */ } })

  // 3) 面板
  const register = (scope) => {
    const ws = scope.webServer
    if (!ws?.register) return

    scope.effect(() => ws.register({
      kind: 'exact',
      path: PANEL_PATHNAME,
      handler: (req, res) => {
        if (!isLoopback(req)) return sendJson(res, 403, { ok: false, error: 'loopback only' })
        try {
          const html = readFileSync(PANEL_PATH, 'utf8')
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
          res.end(html)
        } catch (err) { sendJson(res, 500, { ok: false, error: String(err?.message ?? err) }) }
      },
    }), 'qqbot-refine: panel')

    scope.effect(() => ws.register({
      kind: 'exact',
      path: API_STATE,
      handler: (req, res) => {
        if (!isLoopback(req)) return sendJson(res, 403, { ok: false, error: 'loopback only' })
        sendJson(res, 200, snapshot())
      },
    }), 'qqbot-refine: state')

    scope.effect(() => ws.register({
      kind: 'exact',
      path: API_CONFIG,
      handler: async (req, res) => {
        if (!isLoopback(req)) return sendJson(res, 403, { ok: false, error: 'loopback only' })
        if ((req.method ?? 'GET') !== 'POST') return sendJson(res, 405, { ok: false, error: 'POST only' })
        try {
          const body = await readBody(req)
          let cfg = loadConfig()
          if (body?.reset === true) cfg = clone(DEFAULTS)
          else {
            const patch = body?.patch ?? {}
            let n = 0
            for (const [k, raw] of Object.entries(patch)) {
              const field = FIELD_MAP.get(k)
              if (!field) continue
              setAt(cfg, k, coerce(field, raw))
              n += 1
            }
            if (!n) return sendJson(res, 400, { ok: false, error: '没有可应用的字段' })
          }
          saveConfig(cfg)
          sendJson(res, 200, { ok: true, saved: true })
        } catch (err) { sendJson(res, 400, { ok: false, error: String(err?.message ?? err) }) }
      },
    }), 'qqbot-refine: config')

    scope.effect(() => ws.register({
      kind: 'exact',
      path: API_ACTION,
      handler: async (req, res) => {
        if (!isLoopback(req)) return sendJson(res, 403, { ok: false, error: 'loopback only' })
        if ((req.method ?? 'GET') !== 'POST') return sendJson(res, 405, { ok: false, error: 'POST only' })
        try {
          const body = await readBody(req)
          const action = body?.action
          const cfg = loadConfig()
          if (action === 'syncSticker') {
            const r = await sticker.syncRemote(cfg, logger)
            return sendJson(res, 200, { ok: true, result: r, sticker: sticker.stats() })
          }
          if (action === 'cleanSticker') {
            return sendJson(res, 200, { ok: true, removed: sticker.cleanExpired(cfg) })
          }
          if (action === 'clearRoleCache') {
            clearRoleCache()
            return sendJson(res, 200, { ok: true })
          }
          if (action === 'groupDiag') {
            return sendJson(res, 200, { ok: true, groups: (cfg.scope.groups ?? []).map((g) => ({ group: g, ...roleDiagnostics(g) })) })
          }
          if (action === 'memoryList') {
            return sendJson(res, 200, { ok: true, items: listMemory(body.peerKey ?? '') })
          }
          if (action === 'memoryForget') {
            return sendJson(res, 200, { ok: true, removed: forgetMemory(body.peerKey ?? '', { id: body.id, keyword: body.keyword }) })
          }
          if (action === 'memoryPin') {
            return sendJson(res, 200, { ok: true, pinned: pinMemory(body.peerKey ?? '', body.id, body.pinned !== false) })
          }
          if (action === 'biliParse') {
            const parsed = bili.extractBili(body.url ?? '')
            if (!parsed) return sendJson(res, 400, { ok: false, error: '不是 B站链接' })
            if (parsed.kind === 'video') {
              const info = await bili.videoInfo(parsed, cfg.bili.cookie)
              const pick = await bili.smartResolution(info, cfg)
              return sendJson(res, 200, { ok: true, info, pick: { qn: pick.qn, h: pick.h, sizeMB: pick.size ? +(pick.size / 1048576).toFixed(1) : 0 } })
            }
            return sendJson(res, 200, { ok: true, parsed })
          }
          if (action === "permGear") {
            const lv = levelOf(body.level)
            if (!lv) return sendJson(res, 400, { ok: false, error: "档位应为 strict / standard / open" })
            const nc = loadConfig()
            for (const [k, v] of Object.entries(lv.patch)) setAt(nc, k, v)
            setAt(nc, "tools.permissionLevel", body.level)
            saveConfig(nc)
            return sendJson(res, 200, { ok: true, level: body.level, applied: lv.patch })
          }
          if (action === "permLevels") return sendJson(res, 200, { ok: true, levels: PERM_LEVELS, current: loadConfig().tools?.permissionLevel })
          if (action === "chatGear") {
            const gv = gearValues(body.gear)
            if (!gv) return sendJson(res, 400, { ok: false, error: "挡位应为 1-5" })
            const nc = loadConfig()
            nc.frequency.chatGear = Number(body.gear)
            for (const [k, v] of Object.entries(gv)) if (k !== "name") nc.frequency[k] = v
            saveConfig(nc)
            return sendJson(res, 200, { ok: true, gear: Number(body.gear), applied: gv })
          }
          if (action === "bindNew") {
            const b = newBind(body.purpose || 'owner', body.ttlMin || 10)
            return sendJson(res, 200, { ok: true, bind: { code: b.code, purpose: b.purpose, expiresAt: b.expiresAt } })
          }
          if (action === "bindCancel") { clearBind(); return sendJson(res, 200, { ok: true }) }
          if (action === "mgmt") {
            return sendJson(res, 200, { ok: true, ...(await mgmt.list(body.kind, body.key, body)) })
          }
          if (action === "mgmtOp") {
            return sendJson(res, 200, mgmt.op(body.kind, body.op, body))
          }
          if (action === "profileList") {
            return sendJson(res, 200, { ok: true, group: body.group, stats: profile.stats(body.group), members: profile.listMembers(body.group) })
          }
          if (action === "knowledgeImport") {
            return sendJson(res, 200, importKbFromPath(String(body.path ?? ""), { asName: String(body.name ?? "") }))
          }
          if (action === "knowledgeList") {
            return sendJson(res, 200, { ok: true, files: listKbFiles(), dir: kbStats().dir })
          }
          if (action === "knowledgeRead") {
            return sendJson(res, 200, readKbFile(body.file))
          }
          if (action === "knowledgeSave") {
            return sendJson(res, 200, saveKbFile(String(body.file ?? ""), String(body.text ?? ""), { append: body.append === true }))
          }
          if (action === "knowledgeDelete") {
            return sendJson(res, 200, deleteKbFile(String(body.file ?? "")))
          }
          if (action === "knowledgeName") {
            return sendJson(res, 200, { ok: true, file: kbNameForPeer(String(body.peerKey ?? "")) })
          }
          if (action === "esportsSync") {
            const r = await syncEsports(cfg, logger)
            return sendJson(res, 200, { ok: !!r.ok, result: { got: r.got || 0, kept: r.kept || 0, added: r.added || 0, source: r.source || "", errors: r.errors || [] }, error: r.ok ? "" : r.error })
          }
          if (action === "voiceStatus") {
            const probe = await probeVoice(cfg)
            globalThis.__qqrefineVoiceProbe = probe
            return sendJson(res, 200, { ok: true, probe, last: lastJobInfo(), stt: { enabled: cfg.stt?.enabled === true, hasCommand: !!(cfg.stt?.command ?? "").trim(), timeoutMs: cfg.stt?.timeoutMs ?? 0 } })
          }
          if (action === "assetsStatus") {
            const st = assetStatus(cfg)
            return sendJson(res, 200, { ok: true, ...st, progress: progressOf(), dataDir: DATA_DIR, pointer: dataPointer(), sttAuto: sttAutoCommand(cfg) })
          }
          if (action === "downloadAsset") {
            const id = String(body.id ?? '')
            void downloadAsset(id, cfg, logger).catch(() => {})
            return sendJson(res, 200, { ok: true, started: true, id })
          }
          if (action === "removeAsset") {
            return sendJson(res, 200, removeAsset(String(body.id ?? ''), cfg))
          }
          if (action === "applySttCommand") {
            const cmdLine = sttAutoCommand(cfg)
            if (!cmdLine) return sendJson(res, 200, { ok: false, error: "还没下载 whisper 模型" })
            const nc = loadConfig()
            nc.stt.command = cmdLine
            nc.stt.enabled = true
            saveConfig(nc)
            return sendJson(res, 200, { ok: true, command: cmdLine })
          }
          if (action === "profileSeed") {
            const roster = loadRoster()
            const list = roster.members[String(body.group)]?.list ?? []
            if (!list.length) return sendJson(res, 200, { ok: false, error: "名册里还没有这个群的成员（先刷新名册）" })
            const r = profile.seedMembers(body.group, list, cfg)
            return sendJson(res, 200, { ok: true, ...r, members: profile.listMembers(body.group) })
          }
          if (action === "profileNoticesClear") {
            return sendJson(res, 200, { ok: true, ...profile.clearNotices(body.group) })
          }
          if (action === "profileInduce") {
            const r = profile.induce(body.group, cfg)
            return sendJson(res, 200, { ok: true, ...r, members: profile.listMembers(body.group) })
          }
          if (action === "profileInduceLlm") {
            if (!llmRef?.stream) return sendJson(res, 200, { ok: false, error: "宿主没有可用的 llm 服务（llmRef 为空）；先用「本地归纳」，或重启 DSH 再试" })
            const routed = withLlmRoute(cfg, 'profile')
            const r = await profile.induceLlm(body.group, routed, llmRef)
            return sendJson(res, 200, { ...r, members: profile.listMembers(body.group) })
          }
          if (action === "profileDelete") {
            return sendJson(res, 200, { ...profile.deleteMember(body.group, body.key, body.seal === true) })
          }
          if (action === "profileClear") {
            return sendJson(res, 200, { ...profile.clearGroup(body.group) })
          }
          if (action === "presets") return sendJson(res, 200, { ok: true, ...listPresets() })
          if (action === "presetText") {
            const p = getPresetText(body.id)
            return p ? sendJson(res, 200, { ok: true, ...p }) : sendJson(res, 404, { ok: false, error: "找不到" })
          }
          if (action === "presetSave") {
            try { return sendJson(res, 200, { ok: true, preset: savePreset(body) }) }
            catch (e) { return sendJson(res, 400, { ok: false, error: String(e?.message ?? e) }) }
          }
          if (action === "presetDelete") return sendJson(res, 200, deletePreset(body.id))
          if (action === "presetToggle") return sendJson(res, 200, togglePreset(body.id, body.enabled))
          if (action === "setCurrent") return sendJson(res, 200, setCurrent(body.id))
          if (action === "setScope") return sendJson(res, 200, setScope(body.scope, body.key, body.id ?? null))
          return sendJson(res, 400, { ok: false, error: `未知操作 ${action}` })
        } catch (err) { sendJson(res, 500, { ok: false, error: String(err?.message ?? err) }) }
      },
    }), 'qqbot-refine: action')

    logger.info?.(`[qqbot-refine] 面板：http://127.0.0.1:<port>${PANEL_PATHNAME}`)
  }

  if (typeof ctx.inject === 'function') ctx.inject(['webServer'], register)
  else register(ctx)

  // 3.5) 工具调用级闸门（等 tools 服务就绪再装，避免 ctx.get 抛错）
  try {
    if (typeof ctx.inject === "function") {
      ctx.inject(["tools"], (s) => { try { installToolGate({ ctx: s, getConfig: loadConfig, logger }) } catch (err) { logger.warn?.("[qqbot-refine] 工具闸门异常: " + err.message) } })
    } else {
      installToolGate({ ctx, getConfig: loadConfig, logger })
    }
  } catch (err) { logger.warn?.("[qqbot-refine] 工具闸门安装失败: " + err.message) }

  // 3.6) 离线巩固：每 10 分钟把白名单群的聊天压成一条摘要（本地，0 token）
  {
    const t = setInterval(() => {
      try { consolidatePeers(mods, loadConfig()) } catch { /* ignore */ }
    }, 10 * 60 * 1000)
    t.unref?.()
    timers.push(t)
  }

  // 4) 定时任务
  stopJobs = startJobs({ getConfig: loadConfig, getBot: () => botRef, diagRef: diag, logger, llmRef })
  ctx.effect?.(() => () => { try { stopJobs?.() } catch { /* ignore */ } }, 'qqbot-refine: jobs')
  // 每日画像归纳（本地统计，0 token）：到点跑一次，同一天只跑一次
  {
    const daily = () => {
      try {
        const cfg = loadConfig()
        const at = String(cfg?.profile?.dailyAt ?? '').trim()
        const want = /^\d{1,2}:\d{2}$/.test(at) ? at : ''
        if (!want) return
        const now = new Date()
        const hhmm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0')
        if (hhmm !== want) return
        const day = now.toISOString().slice(0, 10)
        if ((state['profile-daily'] ?? '') === day) return
        state['profile-daily'] = day
        let total = 0
        for (const g2 of (cfg?.scope?.groups ?? [])) {
          try { const r = profile.induce(String(g2), cfg); total += r.updated } catch { /* ignore */ }
        }
        audit('profile.daily', { updated: total })
      } catch { /* ignore */ }
    }
    const t3 = setInterval(daily, 60 * 1000)
    t3.unref?.()
    ctx.effect?.(() => () => { clearInterval(t3) }, 'qqbot-refine: profile-daily')
  // 赛事赛程自动同步：每小时检查一次，按 esports.refreshHours 决定要不要真拉
  {
    const tick4 = () => {
      try {
        const cfg = loadConfig()
        if (cfg?.esports?.enabled !== true) return
        const hours = Math.max(1, Number(cfg?.esports?.refreshHours ?? 6))
        const last = Number(esportsCache()?.at ?? 0)
        if (last && Date.now() - last < hours * 3600 * 1000) return
        syncEsports(cfg, logger).catch(() => {})
      } catch { /* ignore */ }
    }
    const t4 = setInterval(tick4, 60 * 60 * 1000)
    t4.unref?.()
    setTimeout(tick4, 20 * 1000).unref?.()
    ctx.effect?.(() => () => { clearInterval(t4) }, 'qqbot-refine: esports-tick')
  }
  }

  ctx.effect?.(() => () => {
    try { stopTransport() } catch { /* ignore */ }
    for (const t of timers) { try { clearTimeout(t); clearInterval(t) } catch { /* ignore */ } }
  }, 'qqbot-refine: transport')

  logger.info?.(`[qqbot-refine] 已启动：SDK=${diag.sdkVersion ?? '?'} 入站钩子=${diag.patch.inbound} 出站钩子=${diag.patch.outbound}`)
}

export default apply




