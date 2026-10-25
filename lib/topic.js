/**
 * 话题状态：这个群「现在在聊哪一场/哪件事」
 *
 * 解决的真问题：群里在聊「上一场（MSI 让二追三）」，她却在聊「今天这一场」——
 * 因为她没有「当前话题」这个概念，只看到一条条孤立的消息。
 *
 * 做法（全本地、0 token）：
 *   从消息里认出「队 A vs 队 B」这类对局，存成该群最近的话题；注入人设段时带上时间和提醒。
 *   分不清历史还是今天，就让她先问一句，而不是硬猜。
 */

const TEAMS = new Set([
  'IG','TES','G2','HLE','GEN','T1','BLG','JDG','WBG','LNG','FPX','EDG','RNG','DK','KT','NS','DRX','BRO','FOX',
  'JDG','AL','NIP','TT','WE','OMG','LGD','UP','RA','V5','SN','SS','RW','VG','ES','DMO','SDX','TH','KC','MDK',
  'FNC','MAD','GAM','PSG','CFO','SHG','DFM','LOUD','PNG','100T','TL','C9','FLY','TSM','EG','CLG','IMT','DIG',
])

const MATCH_WORDS = /(?:vs|VS|对|打|和|跟|碰|被|赢|输|压|揍)\s*/
const HISTORY_HINT = /(上\s*一场|上一局|之前|去年|前年|MSI|季中杯|世界赛那年|历史|让二追三|让一追二|翻盘那场|那场)/
const TODAY_HINT = /(今天|今晚|明天|待会|马上|等下|这场|这局|本轮|瑞士轮|淘汰赛|bo[1357])/i

const MAX = 40
const topics = new Map() // peerKey -> [{ a, b, at, kind }]

/** 从一句话里认出对局（纯函数，方便单测） */
export function extractMatch(text) {
  const t = String(text ?? '')
  const tok = t.match(/[A-Za-z0-9]{2,8}/g) ?? []
  const teams = tok.map((x) => x.toUpperCase()).filter((x) => TEAMS.has(x))
  const uniq = [...new Set(teams)]
  if (uniq.length < 2) return null
  // 两个队名之间要离得不太远（同一句里）
  const [a, b] = uniq
  const ia = t.toUpperCase().indexOf(a)
  const ib = t.toUpperCase().indexOf(b)
  if (Math.abs(ia - ib) > 24) return null
  // 两个队名出现在同一段话里，基本就是在聊这场（「TES 被 G2 让二追三」这种没 vs 也算）
  const looksMatch = true
  const kind = HISTORY_HINT.test(t) ? 'history' : TODAY_HINT.test(t) ? 'today' : 'unknown'
  return { a: ia <= ib ? a : b, b: ia <= ib ? b : a, kind }
}

export function noteTopic(peerKey, text, now = Date.now()) {
  const m = extractMatch(text)
  if (!m) return null
  const list = topics.get(peerKey) ?? []
  const last = list[list.length - 1]
  if (last && last.a === m.a && last.b === m.b && now - last.at < 10 * 60 * 1000) { last.at = now; last.kind = m.kind; return last }
  const item = { a: m.a, b: m.b, kind: m.kind, at: now }
  list.push(item)
  while (list.length > MAX) list.shift()
  topics.set(peerKey, list)
  return item
}

export function currentTopic(peerKey) {
  const list = topics.get(peerKey) ?? []
  return list[list.length - 1] ?? null
}

export function topicHistory(peerKey, n = 3) {
  return (topics.get(peerKey) ?? []).slice(-n).reverse()
}

function ago(ms) {
  const min = Math.max(0, Math.round(ms / 60000))
  if (min < 1) return '刚刚'
  if (min < 60) return min + ' 分钟前'
  return Math.round(min / 60) + ' 小时前'
}

/** 注入用的一段话；没话题就返回空 */
export function topicBlock(peerKey, now = Date.now()) {
  const t = currentTopic(peerKey)
  if (!t) return ''
  const seen = topicHistory(peerKey, 3)
  const lines = ['', '# 本群正在聊', '当前：' + t.a + ' vs ' + t.b + '（' + ago(now - t.at) + '提到）']
  const tag = t.kind === 'history' ? '这段在聊 以前的交手/历史战绩' : t.kind === 'today' ? '这段像是在聊 今天/即将进行的这一场' : '分不清在聊历史还是这一场'
  lines.push('判断：' + tag)
  if (seen.length > 1) lines.push('更早还聊过：' + seen.slice(1).map((x) => x.a + ' vs ' + x.b).join('、'))
  lines.push('如果分不清是「之前那场」还是「今天这场」，先用一句话问清（例如「你说的是之前那场还是今天这场？」），别自己猜。')
  return lines.join('\n')
}

export function topicStats() {
  return [...topics.entries()].map(([k, v]) => ({ peerKey: k, count: v.length, current: v[v.length - 1] ?? null }))
}
