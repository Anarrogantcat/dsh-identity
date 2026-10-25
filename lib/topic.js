/**
 * 话题 / 赛程指向（事实只认赛程库，不从聊天里猜）
 *
 * 设计原则（用户明确要求）：
 *   · **不能**根据聊天记录判断在聊哪一场——聊天会串场、会指代不清
 *   · **不能**把选手外号（Kanavi / TheShy / Zeus / 369…）当成队名
 *   · 事实只来自两处：① 本地赛程库 matches.json（权威）② 模型 web_search 后写库（带 source）
 *   · 聊天只用来「指认」：某一对队名恰好就是库里的某场，才敢说「你们在聊这场」；否则让她问一句
 */
import { loadMatches } from './esports.js'

// 选手/解说/教练外号：一律不当队名（长度≤4 的短名另算）
export const PLAYER_NICKS = new Set([
  'kanavi','theshy','zeus','rookie','gumayusi','delight','jiaqi','meiko','knight','chovy','faker','oner','gumayusi',
  'tian','xiaohu','uzi','clearlove','doinb','scout','viper','ruler','peanut','canyon','showmaker','beryl','deft',
  '左手','右手','小狗','厂长','飞科','尺帝','369','3699','missing','hope','elk','light','tarzan','karsa','bin','369',
])

/** 库里出现过的队名（唯一可信的队名来源） */
export function knownTeams() {
  const s = new Set()
  for (const m of loadMatches()) {
    if (m.team1) s.add(String(m.team1).toUpperCase())
    if (m.team2) s.add(String(m.team2).toUpperCase())
  }
  return s
}

const HISTORY_HINT = /(上\s*一场|上一局|之前|去年|前年|MSI|季中杯|历史|让二追三|让一追二|翻盘那场|那次)/

export const todayStr = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
}

/** 今天的赛程（本地库） */
export function todayMatches(now = new Date()) {
  const d = todayStr(now)
  return loadMatches().filter((m) => String(m.date ?? '') === d)
}

/**
 * 聊天里的「指认」：只有队名对得上库里某一场才算数；完全靠库、不靠猜。
 * 返回 null 表示「无法确定」，那就让她问一句。
 */
export function identifyFromText(text, now = new Date()) {
  const t = String(text ?? '')
  const upper = t.toUpperCase()
  const todays = todayMatches(now)
  const all = loadMatches()
  // 先看今天这场
  for (const m of todays) {
    const a = String(m.team1 ?? '').toUpperCase()
    const b = String(m.team2 ?? '').toUpperCase()
    if (!a || !b) continue
    const ia = upper.indexOf(a), ib = upper.indexOf(b)
    if (ia >= 0 && ib >= 0 && Math.abs(ia - ib) <= 40) {
      return { kind: HISTORY_HINT.test(t) ? 'history' : 'today', match: m, from: 'db-today' }
    }
  }
  // 再看历史场次（明确提到历史词才算）
  if (HISTORY_HINT.test(t)) {
    for (const m of [...all].reverse()) {
      const a = String(m.team1 ?? '').toUpperCase()
      const b = String(m.team2 ?? '').toUpperCase()
      if (!a || !b) continue
      const ia = upper.indexOf(a), ib = upper.indexOf(b)
      if (ia >= 0 && ib >= 0 && Math.abs(ia - ib) <= 40) return { kind: 'history', match: m, from: 'db-history' }
    }
  }
  return null
}

function fmt(m) {
  const sc = m.score ? ' ' + m.score : ''
  return m.team1 + ' vs ' + m.team2 + sc + (m.league ? '（' + m.league + '）' : '')
}

/** 注入用：只说库里有的事；没有就明说「没有赛程数据，别猜」 */
export function topicBlock(peerKey, now = new Date()) {
  const todays = todayMatches(now)
  const lines = ['', '# 赛程（只认本地赛程库，不要从聊天里猜）']
  if (!todays.length) {
    lines.push('今天库里没有赛程记录。群里聊到比赛时：不要自己指定是哪一场，先用一句话问清（「你说的是哪一场？之前那场还是今天的？」），或者用 web_search 查证后再答。')
    return lines.join('\n')
  }
  lines.push('今天：' + todays.map(fmt).join('；'))
  lines.push('判断依据：只有队名与库里一致时才算「在聊这一场」；分不清历史还是今天，先问一句，不要替群里认定。')
  lines.push('选手外号（Kanavi、TheShy、Zeus、369…）不是队名，别拿它们当对阵去推。')
  return lines.join('\n')
}

export function topicStats() {
  return { today: todayMatches().length, total: loadMatches().length }
}

// 兼容旧调用点
export function noteTopic() { return null }
export function currentTopic() { return null }
