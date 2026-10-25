/**
 * 赛事速查（本地小数据库，不联网也能答）
 *
 * 为什么不用现成 API（都实测过）：
 *   · Leaguepedia Cargo API（lol.fandom.com）→ 本机出口 IP 被限流，返回 ratelimited
 *   · 官方 lolesports API（esports-api.lolesports.com）→ 公开 key 已 403
 * 所以走「本地缓存 + 模型自己 web_search」：缓存是权威的已知结果，检索 0 token。
 *
 * 文件：<store>/matches.json
 *   [{ date:'2026-10-26', league:'Worlds 2026', team1:'HLE', team2:'IG', score:'1:2', winner:'IG', note:'瑞士轮 R3', source:'用户录入' }]
 */
import { join } from 'node:path'
import { readJson, writeJson, dirs } from './store.js'

export const MATCH_PATH = join(dirs.root, 'matches.json')
const MAX = 500

export function loadMatches() {
  const j = readJson(MATCH_PATH, null)
  if (!Array.isArray(j)) return []
  return j.filter((m) => m && m.team1 && m.team2)
}

export function saveMatches(list) {
  writeJson(MATCH_PATH, list.slice(-MAX))
}

const norm = (s) => String(s ?? '').trim().toUpperCase()

/** 关键词匹配：队名/联赛模糊包含 */
export function searchMatches(keyword = '', limit = 5) {
  const k = String(keyword ?? '').trim().toUpperCase()
  const all = loadMatches()
  const hit = !k ? all : all.filter((m) => [m.team1, m.team2, m.league, m.note].filter(Boolean).join(' ').toUpperCase().includes(k))
  return hit.slice(-limit).reverse()
}

/** 两队交手记录 */
export function headToHead(a, b, limit = 5) {
  const A = norm(a), B = norm(b)
  if (!A || !B) return []
  const all = loadMatches().filter((m) => {
    const x = norm(m.team1), y = norm(m.team2)
    return (x.includes(A) && y.includes(B)) || (x.includes(B) && y.includes(A))
  })
  return all.slice(-limit).reverse()
}

export function addMatch({ date, league, team1, team2, score, winner, note, source }) {
  if (!team1 || !team2) return { ok: false, error: '需要两个队名' }
  const list = loadMatches()
  const m = {
    date: String(date ?? '').slice(0, 10) || new Date().toISOString().slice(0, 10),
    league: String(league ?? '').slice(0, 40),
    team1: String(team1).slice(0, 24),
    team2: String(team2).slice(0, 24),
    score: String(score ?? '').slice(0, 12),
    winner: String(winner ?? '').slice(0, 24),
    note: String(note ?? '').slice(0, 60),
    source: String(source ?? '用户录入').slice(0, 40),
  }
  // 同一天同两队的记录覆盖
  const dup = list.findIndex((x) => x.date === m.date && norm(x.team1) === norm(m.team1) && norm(x.team2) === norm(m.team2))
  if (dup >= 0) list[dup] = m
  else list.push(m)
  saveMatches(list)
  return { ok: true, match: m, total: loadMatches().length }
}

export function matchStats() {
  const list = loadMatches()
  const teams = new Set()
  for (const m of list) { teams.add(norm(m.team1)); teams.add(norm(m.team2)) }
  return { total: list.length, teams: teams.size, latest: list.slice(-1)[0] ?? null }
}

/** 给命令用的文本块 */
export function formatMatches(list, title = '赛事记录') {
  if (!list.length) return `${title}：本地还没有记录。让 Owner 用「#赛程 加 2026-10-26 IG 2:1 HLE Worlds」录一条，或者直接让我搜（web_search）。`
  const lines = [`${title}（${list.length} 条，最新在前）：`]
  for (const m of list) {
    const sc = m.score ? ` ${m.score}` : ''
    const w = m.winner ? `（${m.winner} 胜）` : ''
    lines.push(`· ${m.date || '?'} ${m.team1} vs ${m.team2}${sc}${w}${m.league ? `｜${m.league}` : ''}`)
  }
  return lines.join('\n')
}
