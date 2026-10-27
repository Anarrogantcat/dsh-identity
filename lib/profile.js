/**
 * 群成员画像：本地统计（0 token）+ 轻量特质归纳
 * 存储：profiles/<groupHash>/index.json
 *   { members: { <senderHash>: { key, nick, msgs, chars, hours{}, words{}, mentions, botTexts, firstAt, lastAt, traits[], sealed } } }
 * 隐私：只存 hash，不存原始 openid；不推断敏感属性；本人可要求删除（sealed 后不再重建）。
 */
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { readJson, writeJson, dirs, sha } from './store.js'
import { collectStream } from './llmtext.js'
import { memberCard, rolesOf } from './roster.js'

const DAY = 86400000
/** 机器人自己的 QQ（由通道启动时告知），画像里一律排除 */
let selfUid = ''
export function setSelfUid(uid) { selfUid = String(uid ?? '').trim() }
export function isSelfUid(uid) { return !!selfUid && String(uid) === selfUid }

function dirOf(groupOpenid) {
  return join(dirs.profiles, sha(groupOpenid, 12))
}
function indexOf(groupOpenid) {
  return readJson(join(dirOf(groupOpenid), 'index.json'), { group: sha(groupOpenid, 12), members: {} })
}
function saveIndex(groupOpenid, idx) {
  mkdirSync(dirOf(groupOpenid), { recursive: true })
  writeJson(join(dirOf(groupOpenid), 'index.json'), idx)
}

const tokenize = (s) => {
  const out = new Map()
  const t = String(s ?? '')
  for (const m of t.matchAll(/[a-zA-Z0-9_]{2,}/g)) out.set(m[0].toLowerCase(), (out.get(m[0].toLowerCase()) ?? 0) + 1)
  const cjk = t.replace(/[^\u4e00-\u9fa5]+/g, ' ')
  for (const chunk of cjk.split(' ')) {
    for (let i = 0; i < chunk.length - 1; i++) {
      const w = chunk.slice(i, i + 2)
      out.set(w, (out.get(w) ?? 0) + 1)
    }
  }
  return out
}

/** 入站时累计统计（不做任何网络/模型调用） */
/** 兴趣词典（本地归类） */
const INTEREST_WORDS = {
  游戏: ['游戏', '排位', '上分', '开黑', '瓦', 'cs', 'dota', '永劫', '原神', 'lol', '英雄联盟', 'steam'],
  电竞: ['比赛', '战队', 'lpl', 'worlds', 's赛', 'jdg', 'blg', 't1', 'ig', 'hle', 'tes', 'gg', 'kt'],
  生活: ['吃饭', '睡觉', '上班', '下班', '宿舍', '通勤', '外卖', '天气', '周末', '放假'],
  技术: ['代码', '报错', '服务器', '显卡', '内存', '配置', '部署', 'python', 'java', 'linux', 'docker'],
  学业: ['作业', '考试', '论文', '复习', '上课', '老师', '实验'],
  情绪: ['烦', '累', '困', '爽', '开心', '难过', '难受', '崩溃', '无语'],
}

/** 由统计推导标签（带置信度与时间；旧标签按 TTL 过期） */
export function deriveTags(m, cfg) {
  const ttlDays = Math.max(1, Number(cfg?.profile?.traitTtlDays ?? 60))
  const now = Date.now()
  const out = []
  const add = (id, text, conf) => out.push({ id, text, conf: Math.max(0.1, Math.min(0.95, conf)), at: now, source: 'obs' })
  const st = m.style || {}
  const att = m.attitude || {}
  const msgs = Math.max(1, Number(m.msgs ?? 0))
  if (st.msgs && st.short / st.msgs >= 0.6) add('short', '短句党', 0.6 + (st.short / st.msgs) * 0.3)
  if (st.msgs && st.long / st.msgs >= 0.35) add('long', '爱说长句', 0.55 + (st.long / st.msgs) * 0.3)
  if (st.msgs && st.ellipsis / st.msgs >= 0.35) add('ellipsis', '爱用省略号', 0.6)
  if (st.msgs && st.excl / st.msgs >= 0.4) add('excl', '感叹号多', 0.6)
  if (st.msgs && st.emoji / st.msgs >= 0.25) add('emoji', '表情用得多', 0.6)
  if (st.msgs && (st.question || 0) / st.msgs >= 0.3) add('askq', '爱问问题', 0.55)
  const inter = Object.entries(m.interests || {}).sort((a, b) => b[1] - a[1])
  if (inter.length && inter[0][1] >= 3) add('topic', '常聊' + inter[0][0], 0.55 + Math.min(0.3, inter[0][1] / 30))
  if ((att.ask || 0) >= 3) add('toAI', '常找她说话', 0.6 + Math.min(0.3, (att.ask || 0) / 20))
  if ((att.praise || 0) >= 2 && (att.praise || 0) > (att.tease || 0)) add('praise', '对她挺客气', 0.55)
  if ((att.tease || 0) >= 3 && (att.tease || 0) > (att.praise || 0)) add('tease', '爱逗她', 0.55)
  for (const old of (Array.isArray(m.tags) ? m.tags : [])) {
    if (out.some((x) => x.id === old.id)) continue
    const at = Number(old.at ?? 0)
    if (now - at <= ttlDays * 86400000) out.push(old)
  }
  return out.slice(0, 8)
}
export function record(cfg, groupOpenid, senderOpenid, text, mentionedBot, extra = {}) {
  if (!cfg?.profile?.enabled) return
  if (!groupOpenid || !senderOpenid) return
  if (isSelfUid(senderOpenid)) return
  if (String(text ?? '').trim().length < 2) return
  const idx = indexOf(groupOpenid)
  const key = sha(senderOpenid, 12)
  const now = new Date()
  // 名册里有这个人就顺手记下名字/QQ/角色（不在名册里就只留 hash）
  let nick = ''
  let role = ''
  try { nick = memberCard(groupOpenid, senderOpenid) || '' } catch { /* ignore */ }
  try {
    const r = rolesOf(groupOpenid)
    role = r.owners?.some((x) => String(x) === String(senderOpenid)) ? 'owner'
      : r.admins?.some((x) => String(x) === String(senderOpenid)) ? 'admin' : 'member'
  } catch { /* ignore */ }
  const m = (idx.members[key] ??= {
    key, uid: String(senderOpenid), nick, role, msgs: 0, chars: 0, hours: {}, words: {}, mentions: 0,
    firstAt: now.toISOString(), lastAt: now.toISOString(), traits: [], sealed: false,
  })
  if (nick && !m.nick) m.nick = nick
  if (role && !m.role) m.role = role
  if (m.sealed) return
  m.msgs += 1
  m.chars += text.length
  const hourKey = `h${now.getHours()}`
  m.hours[hourKey] = (m.hours[hourKey] ?? 0) + 1
  if (mentionedBot) m.mentions += 1
  for (const [w, n] of tokenize(text)) m.words[w] = (m.words[w] ?? 0) + n

  // ── 风格统计（本地，0 token）──
  const st = (m.style ??= { ellipsis: 0, excl: 0, tilde: 0, emoji: 0, question: 0, short: 0, long: 0, msgs: 0 })
  st.msgs += 1
  const len0 = String(text ?? '').length
  if (len0 <= 10) st.short += 1
  if (len0 >= 30) st.long += 1
  if (/\.{3,}|…/.test(text)) st.ellipsis += 1
  if (/[!！]/.test(text)) st.excl += 1
  if (/[~～]/.test(text)) st.tilde += 1
  if (/[?？]/.test(text)) st.question += 1
  if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(text)) st.emoji += 1

  // ── 对 AI 的态度 ──
  const att = (m.attitude ??= { ask: 0, praise: 0, tease: 0 })
  if (mentionedBot) att.ask += 1
  if (/(厉害|好听|可爱|喜欢|谢谢|好棒|牛|强)/.test(text)) att.praise += 1
  if (/(傻|笨|蠢|滚|烦|闭嘴|笑死)/.test(text)) att.tease += 1

  // ── 兴趣归类 ──
  const inter = (m.interests ??= {})
  for (const [cat, ws] of Object.entries(INTEREST_WORDS)) {
    if (ws.some((w) => String(text ?? '').toLowerCase().includes(w))) inter[cat] = (inter[cat] ?? 0) + 1
  }

  // ── 关系：@ 了谁（群内互动方向）──
  for (const n of (Array.isArray(extra?.mentions) ? extra.mentions : []).slice(0, 3)) {
    const who = String(n || '').trim().slice(0, 20)
    if (!who) continue
    const rel = (idx.relations ??= {})
    const key = (m.nick || senderOpenid) + '>' + who
    rel[key] = (rel[key] ?? 0) + 1
  }
  m.lastAt = now.toISOString()
  // 控制体积：词表只留前 200
  const words = Object.entries(m.words).sort((a, b) => b[1] - a[1]).slice(0, 200)
  m.words = Object.fromEntries(words)
  saveIndex(groupOpenid, idx)
}

/** 本地归纳：读统计 → 生成 traits/interests/toneHint（不调模型） */
/** 长期不发言的成员清理（sealDays），按群节流 6 小时 */
export function maintain(groupOpenid, cfg) {
  const days = Number(cfg?.profile?.sealDays ?? 0)
  const idx = indexOf(groupOpenid)
  const now = Date.now()
  if (!days || days < 1) return { removed: 0 }
  if (idx.maintainedAt && now - Date.parse(idx.maintainedAt) < 6 * 3600 * 1000) return { removed: 0 }
  let removed = 0
  for (const [k, m] of Object.entries(idx.members)) {
    if (m.sealed) continue
    const last = Date.parse(m.lastAt ?? '') || 0
    if (last && now - last > days * DAY) { delete idx.members[k]; removed += 1 }
  }
  idx.maintainedAt = new Date(now).toISOString()
  saveIndex(groupOpenid, idx)
  if (removed) audit('profile.pruned', { group: groupOpenid.slice(0, 8), removed, days })
  return { removed }
}

/** 待发通知（首次建像告知），由通道在下一条消息时发出去 */
export function queueNotice(groupOpenid, text) {
  const idx = indexOf(groupOpenid)
  idx.notices = Array.isArray(idx.notices) ? idx.notices : []
  if (idx.notices.length >= 3) return false
  idx.notices.push({ text: String(text ?? '').slice(0, 120), at: Date.now() })
  saveIndex(groupOpenid, idx)
  return true
}
export function noticesOf(groupOpenid) {
  const idx = indexOf(groupOpenid)
  return Array.isArray(idx.notices) ? idx.notices.slice(-5) : []
}
export function clearNotices(groupOpenid) {
  const idx = indexOf(groupOpenid)
  const n = Array.isArray(idx.notices) ? idx.notices.length : 0
  idx.notices = []
  saveIndex(groupOpenid, idx)
  return { cleared: n }
}

export function takeNotice(groupOpenid) {
  const idx = indexOf(groupOpenid)
  const n = Array.isArray(idx.notices) ? idx.notices : []
  if (!n.length) return ''
  const text = String(n.shift().text ?? '')
  saveIndex(groupOpenid, idx)
  return text
}

export function induce(groupOpenid, cfg) {
  const idx = indexOf(groupOpenid)
  const windowDays = cfg?.profile?.windowDays ?? 7
  const minMsgs = cfg?.profile?.minMsgs7d ?? 20
  const traitsMax = cfg?.profile?.traitsMax ?? 5
  try { maintain(groupOpenid, cfg) } catch { /* ignore */ }
  const now = Date.now()
  let updated = 0
  let fresh = 0

  for (const m of Object.values(idx.members)) {
    if (m.sealed) continue
    if (m.msgs < minMsgs) continue
    const days = Math.max(1, (now - Date.parse(m.firstAt)) / DAY)
    const perDay = m.msgs / Math.min(windowDays, days)
    const avgLen = m.chars / Math.max(1, m.msgs)
    const hours = Object.entries(m.hours).map(([k, v]) => [Number(k.slice(1)), v])
    hours.sort((a, b) => b[1] - a[1])
    const peak = hours.slice(0, 2).map(([h]) => `${h}:00`)
    const night = (m.hours.h0 ?? 0) + (m.hours.h1 ?? 0) + (m.hours.h2 ?? 0) + (m.hours.h3 ?? 0)
    const topWords = Object.entries(m.words).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([w]) => w)

    const traits = []
    if (perDay >= 15) traits.push('很活跃')
    else if (perDay <= 2) traits.push('潜水型')
    if (avgLen >= 60) traits.push('爱说长句')
    else if (avgLen <= 12) traits.push('短句党')
    if (night >= Math.max(3, m.msgs * 0.25)) traits.push('夜猫子')
    if (m.mentions >= Math.max(3, m.msgs * 0.15)) traits.push('常找她说话')
    if (traits.length === 0) traits.push('常规交流')
    if (!m.traits || !m.traits.length) fresh += 1

    m.tags = deriveTags(m, cfg)
    for (const [i, txt] of (Array.isArray(m.llmTraits) ? m.llmTraits : []).entries()) {
      if (!m.tags.some((x) => x.text === txt)) m.tags.push({ id: 'llm' + i, text: String(txt).slice(0, 20), conf: 0.6, at: Date.now(), source: 'llm' })
    }
    m.tags = m.tags.slice(0, 8)
    m.traits = m.tags.map((x) => x.text).slice(0, traitsMax)
    m.peakHours = peak
    m.avgLen = Math.round(avgLen)
    m.topWords = topWords
    m.confidence = Math.min(0.9, 0.2 + m.msgs / 100)
    m.updatedAt = new Date().toISOString()
    updated += 1
  }
  saveIndex(groupOpenid, idx)
  if (fresh > 0 && cfg?.profile?.notifyGroup === true) {
    try { queueNotice(groupOpenid, '本群画像更新：' + fresh + ' 人的特征归纳好了（看面板「认知 · 画像」）') } catch { /* ignore */ }
  }
  return { updated, total: Object.keys(idx.members).length, fresh }
}

/** 速写卡：注入系统提示用（只给前 N 位活跃成员） */
export function speedCard(groupOpenid, cfg) {
  if (!cfg?.profile?.enabled) return ''
  const idx = indexOf(groupOpenid)
  const topN = cfg?.profile?.speedTop ?? 5
  const maxChars = cfg?.profile?.speedChars ?? 120
  const list = Object.values(idx.members)
    .filter((m) => !m.sealed && m.msgs >= (cfg?.profile?.minMsgs7d ?? 20) / 2)
    .sort((a, b) => b.msgs - a.msgs)
    .slice(0, topN)
  if (!list.length) return ''
  const lines = list.map((m, i) => {
    const tags = (m.traits ?? []).join('、') || '常规'
    const words = (m.topWords ?? []).slice(0, 3).join('/')
    const who = m.nick ? `${m.nick}${m.uid ? `（${m.uid}）` : ''}` : `成员${i + 1}`
    return `· ${who}：${tags}${words ? `；常聊 ${words}` : ''}；${m.avgLen ?? '?'} 字左右`
  })
  return `# 本群成员速写（仅供本群对话参考，不要点名套话）\n${lines.join('\n').slice(0, maxChars * topN)}`
}

export function listMembers(groupOpenid) {
  const idx = indexOf(groupOpenid)
  return Object.values(idx.members)
    .filter((m) => !isSelfUid(m.uid))
    .sort((a, b) => b.msgs - a.msgs)
    .map((m) => ({
      key: m.key, uid: m.uid ?? '', nick: m.nick ?? '', role: m.role ?? '',
      msgs: m.msgs, chars: m.chars ?? 0, tags: (m.tags || []).map((x) => ({ text: x.text, conf: Number(x.conf || 0), at: x.at || 0 })), attitude: m.attitude || {}, interests: m.interests || {}, avgLen: m.avgLen ?? (m.msgs > 0 ? Math.round((m.chars ?? 0) / m.msgs) : 0),
      traits: m.traits ?? [], topWords: (m.topWords ?? []).slice(0, 3),
      peakHours: m.peakHours ?? [], lastAt: m.lastAt, sealed: !!m.sealed,
      confidence: m.confidence ?? 0,
    }))
}

export function deleteMember(groupOpenid, key, seal = false) {
  const idx = indexOf(groupOpenid)
  const m = idx.members[key]
  if (!m) return { ok: false, error: '找不到这个成员' }
  if (seal) {
    idx.members[key] = { key, msgs: 0, chars: 0, hours: {}, words: {}, mentions: 0, sealed: true, traits: [], lastAt: new Date().toISOString(), firstAt: new Date().toISOString() }
  } else {
    delete idx.members[key]
  }
  saveIndex(groupOpenid, idx)
  return { ok: true }
}

export function clearGroup(groupOpenid) {
  const idx = indexOf(groupOpenid)
  const n = Object.keys(idx.members).length
  saveIndex(groupOpenid, { group: sha(groupOpenid, 12), members: {} })
  return { ok: true, removed: n }
}

/**
 * 从名册「重新画」：用群成员列表（群名片/昵称/角色）先把身份建好，统计从 0 开始。
 * 只写姓名与角色，不推断任何敏感属性；已有统计的成员不会被清零。
 */
export function seedMembers(groupOpenid, members = [], cfg = null) {
  if (cfg?.profile?.enabled === false) return { ok: false, error: '画像已关闭' }
  const idx = indexOf(groupOpenid)
  let added = 0
  let named = 0
  const now = new Date().toISOString()
  for (const m of members) {
    if (!m || m.id == null) continue
    if (isSelfUid(m.id)) { delete idx.members[sha(String(m.id), 12)]; continue }
    const key = sha(String(m.id), 12)
    const rawName = String(m.card || m.nickname || '').trim()
  const name = /^[\s,，.。·、_\-—~!！?？]*$/.test(rawName) ? '' : rawName
    const role = String(m.role ?? 'member')
    const cur = idx.members[key]
    if (!cur) {
      idx.members[key] = {
        key, nick: name, uid: String(m.id), role,
        msgs: 0, chars: 0, hours: {}, words: {}, mentions: 0,
        firstAt: now, lastAt: now, traits: [], sealed: false,
      }
      added += 1
    } else {
      if (cur.sealed) continue
      if (name) { cur.nick = name; named += 1 }
      else if (cur.nick && /^[\s,，.。·、_\-—~!！?？]*$/.test(String(cur.nick))) cur.nick = ''
      if (role) cur.role = role
      if (!cur.uid) cur.uid = String(m.id)
    }
  }
  saveIndex(groupOpenid, idx)
  return { ok: true, added, named, total: Object.keys(idx.members).length }
}

export function stats(groupOpenid) {
  const idx = indexOf(groupOpenid)
  const members = Object.values(idx.members)
  const spoken = members.filter((m) => (m.msgs ?? 0) > 0 && !isSelfUid(m.uid))
  return {
    total: members.length,
    spoken: spoken.length,
    active: members.filter((m) => m.msgs >= 20).length,
    sealed: members.filter((m) => m.sealed).length,
    msgs: members.reduce((a, m) => a + (m.msgs ?? 0), 0),
  }
}

/**
 * 语义归纳（可选，调宿主 llm）。未配置 provider/model 时直接返回 {ok:false}。
 * 输入只带统计与高频词，**不带 openid**；输出解析失败就保持本地结果。
 */
export async function induceLlm(groupOpenid, cfg, llm, topN = 5) {
  const prov = cfg?.profile?.llmProvider
  const model = cfg?.profile?.llmModel
  if (!prov || !model) return { ok: false, error: '未配置 profile.llmProvider / llmModel' }
  if (!llm?.stream) return { ok: false, error: '宿主 llm 不可用' }
  const idx = indexOf(groupOpenid)
  const list = Object.values(idx.members)
    .filter((m) => !m.sealed && m.msgs >= (cfg?.profile?.minMsgs7d ?? 20))
    .sort((a, b) => b.msgs - a.msgs)
    .slice(0, topN)
  if (!list.length) return { ok: true, updated: 0 }

  let updated = 0
  const llmErrors = []
  for (const m of list) {
    const prompt = [
      '你在给群聊成员写「速写」，只依据下面这些统计，不要编造，不要涉及性别/年龄/职业/收入/健康/政治等敏感推断。',
      `发言数 ${m.msgs}，平均字数 ${m.avgLen ?? 0}，活跃时段 ${(m.peakHours ?? []).join('、') || '未知'}，高频词 ${(m.topWords ?? []).join('、') || '无'}`,
      '输出 JSON：{"traits":["≤4 条短语"],"interests":["≤4 个词"],"toneHint":"一句话建议"}。只输出 JSON。',
    ].join('\n')
    try {
      const r = await collectStream(llm, { provider: prov, model, prompt, maxTokens: 400 })
      const text = r.text
      if (!text) { llmErrors.push('模型没有输出正文'); continue }
      const j = JSON.parse((text.match(/\{[\s\S]*\}/) ?? ['{}'])[0])
      if (Array.isArray(j.traits) && j.traits.length) {
        m.llmTraits = j.traits.slice(0, 4).map((x) => String(x).slice(0, 20))
        updated += 1
      }
      if (Array.isArray(j.interests) && j.interests.length) m.llmInterests = j.interests.slice(0, 4).map((x) => String(x).slice(0, 12))
      if (typeof j.toneHint === 'string') m.toneHint = j.toneHint.slice(0, 60)
      m.updatedAt = new Date().toISOString()
    } catch (err) { llmErrors.push(String(err?.message ?? err).slice(0, 80)) }
  }
  saveIndex(groupOpenid, idx)
  if (!updated) return { ok: false, error: llmErrors[0] || '模型没有给出可用结果', updated: 0 }
  return { ok: true, updated }
}

