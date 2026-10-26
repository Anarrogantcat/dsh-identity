/**
 * 管理数据源：给面板的「管理表」提供统一结构
 *   list(kind) -> { columns, rows, hint, editable }
 *   op(kind, op, body) -> { ok, ... }
 */
import { readFileSync, readdirSync, existsSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { loadConfig, saveConfig } from './config.js'
import { dirs, sha, audit } from './store.js'
import { roleDiagnostics, clearRoleCache } from './roles.js'
import { listMemory, forgetMemory, pinMemory } from './memory.js'
import { loadIndex, saveIndex, stats as stickerStats } from './sticker.js'
import { state } from './state.js'
import * as diagRef from './diag.js'
import { usageReport, resetToday } from './usage.js'
import { resetLocalMood } from './moodlocal.js'
import { budgetState, resetCostGuard } from './cost.js'
import { resetLlmState } from './moodllm.js'

const uniq = (arr) => [...new Set(arr)]

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
    case 'groups':
      return {
        hint: '群白名单：只有这里的群能触发任何功能。群里发 #绑定本群 可自动加入。',
        columns: [{ k: 'value', l: '群 openid' }, { k: 'cached', l: '群管缓存' }],
        rows: cfg.scope.groups.map((g) => ({ value: g, cached: `${roleDiagnostics(g).admins.length} 人` })),
      }
    case 'dmUsers':
      return {
        hint: '私聊白名单：只有这里的人能私聊她。',
        columns: [{ k: 'value', l: '用户 openid' }],
        rows: cfg.scope.dmUsers.map((u) => ({ value: u })),
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
      return {
        hint: '每个会话一份记忆（文件名是 peer 的哈希）。选一个查看条目。',
        columns: [{ k: 'value', l: 'peerKey' }],
        rows: files.map((f) => ({ value: f.replace(/\.json$/, '') })),
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

  return { ok: false, error: '不支持的操作' }
}
