/**
 * 自动记忆：从聊天里捡「关于某个人的明确陈述」，写进记忆卡
 *
 * 原则（宁缺毋滥）：
 *   · 只认第一人称陈述（我…），不猜、不推断
 *   · 问句/假设/玩笑一律跳过（含 吗/？/如果/假如/要是）
 *   · 每条 ≤40 字，每群每天上限可配（默认 15），重复的靠 addMemory 的指纹去重
 *   · 标 source: 'auto'，面板里能看出是自动记的，也方便删
 */
import { addMemory, listMemory } from './memory.js'
import { audit } from './store.js'

const PATTERNS = [
  /我(?:叫|名字是|是)[^\n，。！？]{1,12}/,
  /我(?:住在?|在|来自)[^\n，。！？]{1,16}/,
  /我(?:喜欢|爱吃|爱喝|爱玩|爱看)[^\n，。！？]{1,18}/,
  /我(?:不喜欢|讨厌|不吃|不喝|受不了)[^\n，。！？]{1,18}/,
  /我(?:在|做|干)(?:工作|上班|读书|上学)[^\n，。！？]{0,14}/,
  /我(?:养了|有一只|有两只)[^\n，。！？]{1,14}/,
  /我(?:今年|明年|已经)[^\n，。！？]{1,14}/,
  /我(?:明天|后天|下周|下个月|这周|这周末)[^\n，。！？]{1,20}/,
  /我(?:要|得|必须)(?:去|考试|上班|出差|搬家|面试|加班)[^\n，。！？]{0,14}/,
  /^这(?:周|周末|个月|两天)[^\n，。！？]{1,18}/,
]

const RECENT = new Map()
/** 每个会话最近记过的事实（进程内，配合磁盘检查双保险） */
function recentSet(peerKey) {
  const k = String(peerKey)
  if (!RECENT.has(k)) RECENT.set(k, new Set())
  const s = RECENT.get(k)
  if (s.size > 200) { const it = s.values(); for (let i = 0; i < 50; i++) s.delete(it.next().value) }
  return s
}

const SKIP = /[?？]|吗|呢？|如果|假如|要是|比如|说不定|开玩笑|哈哈|笑死/

/** 从一句话里捡事实（可能多条） */
export function extractFacts(text) {
  const s = String(text ?? '').trim()
  if (!s || s.length > 200) return []
  if (SKIP.test(s)) return []
  const out = []
  for (const re of PATTERNS) {
    const m = s.match(re)
    if (!m) continue
    const fact = m[0].replace(/\s+/g, ' ').trim().slice(0, 40)
    if (fact.length < 4) continue
    if (!out.includes(fact)) out.push(fact)
  }
  return out.slice(0, 3)
}

/** 写进记忆；返回写了几条 */
export function autoRemember(peerKey, text, { uid = '', nick = '', cfg = {} } = {}) {
  if (cfg?.memory?.enabled === false) return 0
  if (cfg?.memory?.auto === false) return 0
  const facts = extractFacts(text)
  if (!facts.length) return 0
  // 进程内先去重（磁盘写入有节流，光看文件会漏），再合并磁盘里的
  const seen = recentSet(peerKey)
  const existing = (() => { try { return (listMemory(peerKey) ?? []).map((x) => String(x.text ?? '')) } catch { return [] } })()
  let n = 0
  for (const fact of facts) {
    // 同一条事实（含「昵称：」前缀）已经记过就不再堆
    const body = (nick ? nick + '：' : '') + fact
    // 去重只看事实本身（忽略「昵称：」前缀）
    if (seen.has(fact) || existing.some((x) => x === body || String(x).endsWith(fact))) continue
    try {
      addMemory(peerKey, {
        text: (nick ? nick + '：' : '') + fact,
        category: 'fact',
        importance: 0.45,
        emotion: 0,
        source: 'auto',
      })
      seen.add(fact)
      n += 1
    } catch { /* 单条失败不影响其它 */ }
  }
  if (n) { try { audit('memory.auto', { peer: String(peerKey).slice(0, 12), n, uid: String(uid).slice(0, 12) }) } catch { /* ignore */ } }
  return n
}
