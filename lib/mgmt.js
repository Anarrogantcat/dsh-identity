/**
 * 管理数据源：给面板的「管理表」提供统一结构
 *   list(kind) -> { columns, rows, hint, editable }
 *   op(kind, op, body) -> { ok, ... }
 */
import { readFileSync, readdirSync, existsSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { loadConfig, saveConfig } from './config.js'
import { dirs, sha, audit, peerKey } from './store.js'
import { roleDiagnostics, clearRoleCache } from './roles.js'
import { listMemory, forgetMemory, pinMemory } from './memory.js'
import { loadIndex, saveIndex, stats as stickerStats } from './sticker.js'
import { state } from './state.js'
import * as diagRef from './diag.js'
import { usageReport, resetToday } from './usage.js'
import { resetLocalMood } from './moodlocal.js'
import { budgetState, resetCostGuard } from './cost.js'
import { resetLlmState } from './moodllm.js'
import { transportDescribe, getOneBotClient } from './transport.js'
import { capabilitySummary, CAP_LABELS, modeOf } from './capabilities.js'
import { kbStats, loadAllChunks, searchKnowledge, KB_DIR } from './knowledge.js'
import { loadMatches, matchStats, headToHead, addMatch, saveMatches, formatMatches, searchMatches } from './esports.js'
import { rosterStats, groupChoices, loadRoster, refreshAll as rosterRefreshAll, refreshMembers as rosterRefreshMembers } from './roster.js'
import { topicStats, currentTopic } from './topic.js'
import { spendToday, budgetState as costState } from './cost.js'
import * as safetyMod from './safety.js'
import * as cardsMod from './cards.js'

const uniq = (arr) => [...new Set(arr)]

/** 旧通道（官方）留下的 openid：长十六进制串；onebot 的真实群号/QQ 是纯数字 */
export function isLegacyPeer(v) {
  const s = String(v ?? '')
  if (!s) return false
  if (/^\d+$/.test(s)) return false
  return /^[0-9a-fA-F]{20,}$/.test(s)
}

/** peerKey（哈希） → 人类可读：群名（群号）/ 昵称（QQ） */
function peerLabels() {
  const roster = loadRoster()
  const map = new Map()
  for (const g of roster.groups ?? []) map.set(peerKey('group', g.id), '群 ' + (g.name || '') + '（' + g.id + '）')
  for (const f2 of roster.friends ?? []) map.set(peerKey('c2c', f2.id), '私聊 ' + (f2.remark || f2.nickname || '') + '（' + f2.id + '）')
  return map
}

function arrays(cfg) {
  cfg.scope.groups ??= []
  cfg.scope.dmUsers ??= []
  cfg.roles.owners ??= []
  cfg.roles.admins ??= []
  cfg.bili.ups ??= []
  cfg.privacy.blockKeywords ??= []
  cfg.privacy.redactKeywords ??= []
  cfg.order.autoRecallKeywords ??= []
}

export function list(kind) {
  const cfg = loadConfig()
  arrays(cfg)
  switch (kind) {
    case 'groups': {
      const roster = loadRoster()
      const onebot = modeOf(cfg) === 'onebot'
      return {
        hint: onebot
          ? '群白名单：只有这里的群能触发任何功能。下面是真实群号；旧通道留下的 openid 会标「旧通道」，建议用「从群列表选择」重新加，再加「清理旧通道条目」。'
          : '群白名单：只有这里的群能触发任何功能。群里发 #绑定本群 可自动加入。',
        columns: [{ k: 'value', l: '群号' }, { k: 'name', l: '群名' }, { k: 'cached', l: '群管缓存' }, { k: 'legacy', l: '' }],
        rows: cfg.scope.groups.map((g) => {
          const hit = roster.groups.find((x) => String(x.id) === String(g))
          return {
            value: g,
            name: hit?.name ?? '',
            cached: `${roleDiagnostics(g).admins.length} 人`,
            legacy: isLegacyPeer(g) ? '旧通道' : '',
          }
        }),
      }
    }
    case 'dmUsers': {
      const roster = loadRoster()
      const onebot = modeOf(cfg) === 'onebot'
      return {
        hint: onebot ? '私聊白名单：下面是真实 QQ 号 + 名册里的昵称/备注。' : '私聊白名单：只有这里的人能私聊她。',
        columns: [{ k: 'value', l: 'QQ 号' }, { k: 'name', l: '昵称' }, { k: 'legacy', l: '' }],
        rows: cfg.scope.dmUsers.map((u) => {
          const f2 = roster.friends.find((x) => String(x.id) === String(u))
          return { value: u, name: f2?.remark || f2?.nickname || '', legacy: isLegacyPeer(u) ? '旧通道' : '' }
        }),
      }
    }
    case 'owners':
      return {
        hint: 'Owner：最高权限，永不被禁言/闭麦/丢弃，可用危险命令。',
        columns: [{ k: 'value', l: 'openid' }],
        rows: cfg.roles.owners.map((u) => ({ value: u })),
      }
    case 'admins':
      return {
        hint: '手动 Admin：本群内可撤回/禁言/闭麦；QQ 群主与群管会自动成为 Admin。',
        columns: [{ k: 'value', l: 'openid' }],
        rows: cfg.roles.admins.map((u) => ({ value: u })),
      }
    case 'memoryPeers': {
      const files = existsSync(dirs.memory) ? readdirSync(dirs.memory).filter((f) => f.endsWith('.json')) : []
      const labels = peerLabels()
      return {
        hint: '每个会话一份记忆（文件名是 peer 的哈希，右边是它对应的真实群/QQ）。选一个查看条目。',
        columns: [{ k: 'value', l: 'peerKey' }, { k: 'who', l: '对应群 / 人' }],
        rows: files.map((f) => {
          const k = f.replace(/\.json$/, '')
          return { value: k, who: labels.get(k) ?? '' }
        }),
      }
    }
    case 'memoryItems': {
      const peerKey = arguments[1] ?? ''
      const items = peerKey ? listMemory(peerKey) : []
      return {
        hint: peerKey ? `共 ${items.length} 条；P 为召回权重，A 为鲜活度。` : '先选一个 peer。',
        columns: [{ k: 'id', l: 'id' }, { k: 'text', l: '内容' }, { k: 'P', l: 'P' }, { k: 'A', l: 'A' }, { k: 'pinned', l: 'pin' }],
        rows: items.map((i) => ({ id: i.id, text: i.text.slice(0, 40), P: i.P, A: i.A, pinned: i.pinned ? '✓' : '' })),
      }
    }
    case 'stickers': {
      const idx = loadIndex()
      return {
        hint: `共 ${idx.items.length} 张；来源分为 fisharchive / collected / generated。`,
        columns: [{ k: 'id', l: 'id' }, { k: 'moods', l: '情绪' }, { k: 'tags', l: '标签' }, { k: 'source', l: '来源' }],
        rows: idx.items.slice(0, 200).map((i) => ({
          id: i.id,
          moods: (i.moods ?? []).join('/') || '—',
          tags: (i.tags ?? []).slice(0, 3).join('/'),
          source: i.source ?? 'unknown',
        })),
      }
    }
    case 'audit': {
      const p = join(dirs.logs, 'audit.jsonl')
      let rows = []
      try {
        const lines = readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).slice(-100).reverse()
        rows = lines.map((l) => {
          try {
            const j = JSON.parse(l)
            return { at: (j.at ?? '').slice(5, 19).replace('T', ' '), kind: j.kind ?? '', detail: JSON.stringify(j).slice(0, 90) }
          } catch { return { at: '', kind: 'bad', detail: l.slice(0, 60) } }
        })
      } catch { /* no audit yet */ }
      return { hint: '最近 100 条闸门动作（禁言/撤回/闭麦/丢弃/图库同步…）', columns: [{ k: 'at', l: '时间' }, { k: 'kind', l: '动作' }, { k: 'detail', l: '详情' }], rows }
    }
    case 'biliSubs':
      return {
        hint: '订阅的 UP 主（mid）。推送目标 = 白名单群。',
        columns: [{ k: 'value', l: 'UP mid' }],
        rows: cfg.bili.ups.map((u) => ({ value: String(u) })),
      }
    case 'usage': {
      const u = usageReport(cfg)
      const budget = Number(cfg.usage?.groupDailyYuan ?? 0)
      const rows = []
      if (!u.ok) {
        rows.push({ k: '真实用量', v: u.error ?? '读不到' })
      } else {
        const pct = budget > 0 ? Math.round((u.totals.yuan / budget) * 100) : 0
        const flag = budget > 0 && u.totals.yuan >= budget ? '（超预算）' : ''
        rows.push({ k: '今日花费（估算）', v: `¥${u.totals.yuan.toFixed(2)}${flag}` })
        rows.push({ k: '今日预算', v: budget > 0 ? `¥${budget.toFixed(2)}（已用 ${pct}%）` : '未设置' })
        rows.push({ k: '今日 tokens', v: `入 ${u.totals.input} / 出 ${u.totals.output} / 缓存命中 ${u.totals.hit}` })
        rows.push({ k: '本会话累计', v: `¥${u.all.yuan.toFixed(2)} · ${u.all.total} tokens` })
        {
          const b = budgetState(cfg)
          const label = b.state === 'off' ? '关（只记录）'
            : b.state === 'ok' ? `正常（¥${(b.spent ?? 0).toFixed(2)} / ¥${b.limit.toFixed(2)}）`
            : b.state === 'warn' ? `接近上限（¥${(b.spent ?? 0).toFixed(2)} / ¥${b.limit.toFixed(2)}）`
            : b.state === 'exceed' ? `已超（¥${(b.spent ?? 0).toFixed(2)} / ¥${b.limit.toFixed(2)}）→ ${b.action === 'mute' ? '静默' : '降级回模板'}`
            : '未知（读不到用量）'
          rows.push({ k: '花费硬闸', v: label })
        }
        rows.push({ k: '单价（元/百万）', v: `未命中 ${u.prices.inputMiss} · 命中 ${u.prices.inputHit} · 输出 ${u.prices.output}` })
        if (u.rows.length) {
          for (const r of u.rows) {
            const name = r.scope === 'group' ? `群 ${r.peer.slice(0, 8)}` : `私聊 ${r.peer.slice(0, 8)}`
            rows.push({ k: `　${name}`, v: `¥${r.yuan.toFixed(2)} · ${r.tokens.total} tokens` })
          }
        } else {
          rows.push({ k: '　暂无用量', v: '今天还没在这个群里说过话' })
        }
      }
      rows.push(
        { k: '入站消息', v: diagRef.diag.counts.inbound },
        { k: '被拦截', v: diagRef.diag.counts.blocked },
        { k: '出站消息', v: diagRef.diag.counts.outbound },
        { k: '脱敏次数', v: diagRef.diag.counts.redacted },
        { k: '标记触发', v: diagRef.diag.counts.markers },
        { k: '闭麦中的群', v: Object.keys(state.muted ?? {}).length },
        { k: '图库张数', v: stickerStats().total },
        { k: 'SDK 版本', v: diagRef.diag.sdkVersion ?? '?' },
        { k: '钩子', v: `入站${diagRef.diag.patch.inbound ? '✅' : '❌'} 出站${diagRef.diag.patch.outbound ? '✅' : '❌'}` },
      )
      return {
        hint: '真实 token 用量按 DSH 会话快照计算，金额按下面单价折算（估算，缓存未命中的判定由 DSH 给）。「今日」从当天第一次读取起算。',
        columns: [{ k: 'k', l: '指标' }, { k: 'v', l: '值' }],
        rows,
      }
    }
    case 'transport': {
      const t = transportDescribe()
      const caps = capabilitySummary(cfg)
      const h = t.health === 'ok' ? '🟢 正常' : t.health === 'warn' ? '🟡 可疑' : '🔴 异常'
      const rows = [
        { k: '当前通道', v: t.mode === 'onebot' ? 'OneBot（自建，不依赖其他插件）' : '官方 QQ（im-qqbot）' },
        { k: '健康度', v: h },
        { k: '连接', v: t.connected ? '已连接' : '未连接' },
        { k: '账号', v: t.account?.uin ? t.account.uin + (t.account.nickname ? '（' + t.account.nickname + '）' : '') : '—' },
        { k: '地址', v: t.endpoint || '—' },
        { k: '延迟', v: t.latencyMs != null ? t.latencyMs + 'ms' : '—' },
        { k: '最近事件', v: t.lastEventAt ? Math.max(0, Math.round((Date.now() - t.lastEventAt) / 1000)) + ' 秒前' : '还没有' },
        { k: '重连次数', v: t.reconnects ?? 0 },
        { k: '今日发送', v: '成功 ' + (t.sentToday ?? 0) + ' / 失败 ' + (t.failedToday ?? 0) + (t.successRate != null ? '（' + t.successRate + '%）' : '') },
        { k: '会话数', v: t.channel?.sessions ?? 0 },
        { k: '熔断', v: t.breaker?.open ? '保护中（到 ' + new Date(t.breaker.until).toLocaleString() + '）' : '正常' },
        { k: '最后错误', v: t.lastError || '—' },
        { k: '能力位', v: caps.available.length + '/' + caps.total },
      ]
      for (const k of Object.keys(CAP_LABELS)) {
        const ok = !caps.missing.includes(k)
        rows.push({ k: (ok ? '✅ ' : '⬜ ') + CAP_LABELS[k], v: ok ? '可用' : (caps.mode === 'tencent' ? '官方通道不支持（切 onebot 可用）' : '当前不可用') })
      }
      rows.push({ k: '另一条通道', v: t.mode === 'onebot' ? '官方 QQ · 未启用' : 'OneBot · 未启用' })
      return {
        hint: '改通道模式要重启 DSH 才生效。能力位由模式决定：官方通道拿不到的（群名片/成员/撤回/戳/转发/表情/引用/视频/STT）在官方模式整块跳过。',
        columns: [{ k: 'k', l: '项' }, { k: 'v', l: '值' }],
        rows,
      }
    }
    case 'knowledge': {
      const st = kbStats()
      const rows = [
        { k: '目录', v: st.dir || KB_DIR },
        { k: '文件数', v: st.files ?? 0 },
        { k: '段数', v: st.chunks ?? 0 },
        { k: '来源', v: (st.providers ?? ['md']).join(' / ') },
        { k: '赛程段', v: st.esports ?? 0 },
      ]
      return {
        hint: 'common.md 所有群共享，g_xxx.md 只给那个群。改完 markdown 立即生效（每次检索都重读）。',
        columns: [{ k: 'k', l: '项' }, { k: 'v', l: '值' }],
        rows,
      }
    }
    case 'knowledgePreview': {
      const file = String(arguments[1] ?? 'common.md')
      const p = join(KB_DIR, file)
      let body = ''
      try { body = readFileSync(p, 'utf8') } catch { body = '（读不到 ' + file + '）' }
      return { hint: '文件：' + file, columns: [{ k: 'k', l: '内容' }, { k: 'v', l: '正文' }], rows: [{ k: file, v: body.slice(0, 3000) }] }
    }
    case 'knowledgeSearch': {
      const q = String(arguments[1] ?? arguments[2]?.q ?? '')
      const hits = q ? searchKnowledge(q, 'common', { top: 5 }) : []
      return {
        hint: q ? ('「' + q + '」命中 ' + hits.length + ' 段') : '输入一句话试跑检索',
        columns: [{ k: 'title', l: '来源' }, { k: 'score', l: '分' }, { k: 'text', l: '内容' }],
        rows: hits.map((h) => ({ title: h.title || h.peerKey || '', score: h.score != null ? Number(h.score).toFixed(2) : '', text: String(h.text ?? '').slice(0, 120) })),
      }
    }
    case 'matches': {
      const list = loadMatches().slice(-30).reverse()
      const today = new Date().toISOString().slice(0, 10)
      return {
        hint: '同一天同两队重复录入会覆盖。今天有 ' + matchStats().today + ' 场前，面板高亮显示。',
        columns: [{ k: 'date', l: '日期' }, { k: 'teams', l: '对阵' }, { k: 'score', l: '比分' }, { k: 'league', l: '联赛' }, { k: 'today', l: '' }],
        rows: list.map((m) => { const st = m.state === 'completed' ? '已结束' : m.state === 'inProgress' ? '进行中' : m.state === 'unstarted' ? '未开始' : ''; return { date: (m.date ?? '') + (m.time ? ' ' + m.time : ''), teams: m.team1 + ' vs ' + m.team2, score: [m.score || '待补', st].filter(Boolean).join(' · '), league: [m.league || '', m.note || ''].filter(Boolean).join(' '), today: m.date === today ? '今天' : '' } }),
      }
    }
    case 'matchesH2H': {
      const a = String(arguments[1] ?? '')
      const b = String(arguments[2]?.b ?? arguments[2]?.key2 ?? '')
      const rows = (a && b) ? headToHead(a, b, 10) : searchMatches(a, 10)
      return { hint: '两队交手（或按关键词搜索）', columns: [{ k: 'date', l: '日期' }, { k: 'teams', l: '对阵' }, { k: 'score', l: '比分' }], rows: rows.map((m) => ({ date: m.date ?? '', teams: m.team1 + ' vs ' + m.team2, score: m.score || '待补' })) }
    }
    case 'roster': {
      const st = rosterStats()
      const rows = [
        { k: '群', v: st.groups },
        { k: '好友', v: st.friends },
        { k: '缓存成员', v: st.members + '（' + st.cachedGroups + ' 群）' },
        { k: '上次刷新', v: st.updatedAt ? new Date(st.updatedAt).toLocaleString() : '还没刷新' },
        { k: '模式', v: st.supported ? '支持名册' : '当前通道不支持名册' },
      ]
      const groups = loadRoster().groups.slice(0, 20).map((g) => ({ k: '群 ' + (g.name || '(无名)'), v: g.id + ' · ' + g.count + ' 人' }))
      return { hint: '拖不到名册？切 onebot 模式并在面板填好 WS 地址/token。', columns: [{ k: 'k', l: '项' }, { k: 'v', l: '值' }], rows: rows.concat(groups) }
    }
    case 'topics': {
      const st = topicStats()
      return {
        hint: '每个群最后一句 + 当时指认到的赛程（只给面板看，不进提示词）',
        columns: [{ k: 'peerKey', l: '群' }, { k: 'text', l: '最后一句' }, { k: 'match', l: '指认' }, { k: 'at', l: '时间' }],
        rows: (st.rows ?? []).map((r) => ({ peerKey: r.peerKey, text: r.text, match: r.match || '—', at: r.at ? new Date(r.at).toLocaleTimeString() : '' })),
      }
    }
    case 'safety': {
      const s = safetyMod
      let rows = []
      try {
        const b = s?.breakerState?.() ?? null
        rows.push({ k: '安全档位', v: String(cfg.safety?.profile ?? 'normal') })
        rows.push({ k: '熔断', v: b?.open ? '保护中（到 ' + new Date(b.until).toLocaleString() + '）' : '正常' })
        rows.push({ k: '连续失败', v: b?.fails ?? 0 })
        for (const g of (s?.bannedGroups?.() ?? [])) rows.push({ k: '被踢/禁言的群', v: String(g) })
      } catch { rows = [{ k: '安全层', v: '未加载' }] }
      return { hint: '连续 3 次发送失败 → 保护 30 分钟并通知 Owner；被踢会自动从白名单摘掉。', columns: [{ k: 'k', l: '项' }, { k: 'v', l: '值' }], rows }
    }
    case 'cards': {
      const rows = []
      try {
        const pk = String(arguments[1] ?? '')
        if (pk) {
          const block = cardsMod.cognitiveBlock?.(pk, cfg) ?? ''
          rows.push({ k: '认知卡', v: block || '（还没有内容）' })
        } else {
          rows.push({ k: '提示', v: '选一个群看四张卡' })
        }
      } catch { rows.push({ k: '认知卡', v: '读取失败' }) }
      return { hint: '在场的人 / 我说过答应过 / 还没答完的（注入用同一份数据）', columns: [{ k: 'k', l: '项' }, { k: 'v', l: '值' }], rows }
    }
    default:
      return { hint: '未知数据源', columns: [], rows: [] }
  }
}

export function op(kind, opName, body = {}) {
  const cfg = loadConfig()
  arrays(cfg)
  const val = String(body.value ?? body.key ?? '').trim()
  const listField = {
    groups: () => cfg.scope.groups,
    dmUsers: () => cfg.scope.dmUsers,
    owners: () => cfg.roles.owners,
    admins: () => cfg.roles.admins,
    biliSubs: () => cfg.bili.ups,
  }[kind]

  if (listField) {
    const arr = listField()
    if (opName === 'add') {
      if (!val) return { ok: false, error: '不能为空' }
      if (kind === 'biliSubs' && !/^\d{3,}$/.test(val)) return { ok: false, error: 'UP mid 应为数字' }
      if (!arr.includes(val)) arr.push(val)
      saveConfig(cfg)
      audit('mgmt.add', { kind, value: sha(val, 8) })
      return { ok: true }
    }
    if (opName === 'pruneLegacy') {
      const next = arr.filter((x) => !isLegacyPeer(x))
      const removed = arr.length - next.length
      if (kind === 'groups') cfg.scope.groups = next
      else if (kind === 'dmUsers') cfg.scope.dmUsers = next
      else if (kind === 'owners') cfg.roles.owners = next
      else if (kind === 'admins') cfg.roles.admins = next
      else cfg.bili.ups = next
      saveConfig(cfg)
      audit('mgmt.pruneLegacy', { kind, removed })
      return { ok: true, removed }
    }
    if (opName === 'remove') {
      const next = arr.filter((x) => x !== val)
      const removed = arr.length - next.length
      if (kind === 'groups') cfg.scope.groups = next
      else if (kind === 'dmUsers') cfg.scope.dmUsers = next
      else if (kind === 'owners') cfg.roles.owners = next
      else if (kind === 'admins') cfg.roles.admins = next
      else cfg.bili.ups = next
      saveConfig(cfg)
      audit('mgmt.remove', { kind, removed })
      return { ok: true, removed }
    }
    return { ok: false, error: '不支持的操作' }
  }

  if (kind === 'memoryItems') {
    if (opName === 'forget') return { ok: true, removed: forgetMemory(body.peerKey ?? '', { id: body.id }) }
    if (opName === 'pin') return { ok: true, pinned: pinMemory(body.peerKey ?? '', body.id, body.pinned !== false) }
  }

  if (kind === 'stickers') {
    if (opName === 'remove') {
      const idx = loadIndex()
      const it = idx.items.find((i) => i.id === (body.id ?? val))
      if (!it) return { ok: false, error: '找不到这张图' }
      if (it.path) { try { unlinkSync(it.path) } catch { /* ignore */ } }
      idx.items = idx.items.filter((i) => i.id !== it.id)
      saveIndex(idx)
      return { ok: true }
    }
  }

  if (kind === 'usage') {
    if (opName === 'reset') {
      const d = diagRef.diag.counts
      d.inbound = 0; d.blocked = 0; d.outbound = 0; d.redacted = 0; d.markers = 0
      resetToday()
      resetCostGuard()
      return { ok: true }
    }
  }

  if (kind === 'mood') {
    if (opName === 'resetLocal') { resetLocalMood(); return { ok: true } }
    if (opName === 'resetLlm') { resetLlmState(); return { ok: true } }
    return { ok: false, error: '不支持的操作' }
  }

  if (kind === 'roles') {
    if (opName === 'clearCache') { clearRoleCache(); return { ok: true } }
  }

  if (kind === 'transport') {
    if (opName === 'ping') {
      const c = (() => { try { return getOneBotClient(cfg) } catch { return null } })()
      if (!c?.connected) return { ok: false, error: '当前没连上（或不是 onebot 通道）' }
      void c.ping().catch(() => {})
      return { ok: true, pending: true }
    }
  }

  if (kind === 'roster') {
    if (opName === 'refresh') {
      const c = (() => { try { return getOneBotClient(cfg) } catch { return null } })()
      if (!c?.connected) return { ok: false, error: '名册需要 onebot 连接' }
      void (async () => {
        try {
          await rosterRefreshAll(c, cfg)
          for (const g of cfg.scope.groups ?? []) await rosterRefreshMembers(c, g, cfg)
        } catch { /* ignore */ }
      })()
      return { ok: true, pending: true }
    }
  }

  if (kind === 'matches') {
    if (opName === 'add') {
      const r = addMatch({
        date: body.date, league: body.league, team1: body.team1, team2: body.team2,
        score: body.score, winner: body.winner, note: body.note, source: body.source ?? '面板录入',
      })
      return r
    }
    if (opName === 'remove') {
      const list = loadMatches()
      const date = String(body.date ?? '')
      const t1 = String(body.team1 ?? '').toUpperCase()
      const t2 = String(body.team2 ?? '').toUpperCase()
      const next = list.filter((m) => !(String(m.date ?? '') === date && String(m.team1).toUpperCase() === t1 && String(m.team2).toUpperCase() === t2))
      saveMatches(next)
      return { ok: true, removed: list.length - next.length }
    }
  }

  if (kind === 'usage' && opName === 'resetCost') {
    resetCostGuard()
    return { ok: true }
  }

  if (kind === 'usage' && opName === 'resetDiag') {
    const d = diagRef.diag.counts
    d.inbound = 0; d.blocked = 0; d.outbound = 0; d.redacted = 0; d.markers = 0
    return { ok: true }
  }

  if (kind === 'safety') {
    if (opName === 'resetBreaker') { safetyMod.resetBreaker(); return { ok: true } }
    if (opName === 'unban') { safetyMod.unbanGroup(String(body.group ?? body.value ?? '')); return { ok: true } }
  }

  return { ok: false, error: '不支持的操作' }
}
