/**
 * 日记（L2）：每天第一人称 3–6 句，素材只来自事实流 events。
 *
 * 规则：
 *   · 0 token（本地拼），不编不存在的事：只引用 events 里真实出现的句数/人数/承诺
 *   · 整篇不注入提示词；只给一句「上次日记」或按需读，避免日记污染现场
 *   · 同一天重复生成幂等（已有就返回旧的，除非 force）
 *   · 不写别人的隐私：正文只写次数、时间、承诺与她自己说过的话摘要
 */
import { join } from 'node:path'
import { readJson, writeJson, dirs, audit } from './store.js'
import { readEvents } from './events.js'

const pad = (n) => String(n).padStart(2, '0')
export const dayStr = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

const dirOf = (peerKey) => join(dirs.root, 'diary', String(peerKey))
const fileOf = (peerKey, date) => join(dirOf(peerKey), `${date}.json`)

export function loadDiary(peerKey, date = dayStr()) {
  const j = readJson(fileOf(peerKey, date), null)
  if (!j || typeof j !== 'object' || !Array.isArray(j.lines) || !j.lines.length) return null
  return { peerKey: String(peerKey), date, ...j }
}

/** 取最近一篇（不含未来），给注入用 */
export function latestDiary(peerKey) {
  const j = readJson(fileOf(peerKey, dayStr()), null)
  if (j && Array.isArray(j.lines) && j.lines.length) return { peerKey: String(peerKey), date: dayStr(), ...j }
  // 没有今天就看昨天
  const y = new Date(Date.now() - 86400000)
  const yj = readJson(fileOf(peerKey, dayStr(y)), null)
  if (yj && Array.isArray(yj.lines) && yj.lines.length) return { peerKey: String(peerKey), date: dayStr(y), ...yj }
  return null
}

const hhmm = (iso) => {
  const d = new Date(iso)
  return Number.isFinite(d.getTime()) ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : ''
}

/**
 * 生成当天日记（本地、确定性）。
 * @returns {{ok:boolean, date:string, lines:string[], skipped?:boolean, error?:string}}
 */
export function generate(peerKey, date = dayStr(), { force = false } = {}) {
  const pk = String(peerKey ?? '')
  if (!pk) return { ok: false, error: 'no peerKey' }
  if (!force) {
    const old = loadDiary(pk, date)
    if (old) return { ok: true, date, lines: old.lines, skipped: true }
  }
  try {
    const evs = readEvents(pk, date)
    const talks = evs.filter((e) => e.kind === 'talk')
    const fromMe = talks.filter((e) => e.origin === 'bot')
    const fromThem = talks.filter((e) => e.origin === 'inbound')
    const promises = evs.filter((e) => e.kind === 'promise' && e.text)
    const who = [...new Set(fromThem.map((e) => String(e.who ?? '').trim()).filter(Boolean))]
    const first = fromThem[0]
    const last = talks[talks.length - 1]
    const lines = []
    if (!talks.length) {
      lines.push('今天群里安安静静的，我基本没说话。')
      lines.push('没发生什么要记住的事，倒也不坏。')
    } else {
      lines.push(`今天群里大约 ${fromThem.length} 句话，我自己说了 ${fromMe.length} 句。`)
      if (who.length) {
        const most = (() => {
          const map = new Map()
          for (const e of fromThem) { const k = String(e.who || '').slice(0, 12); if (k) map.set(k, (map.get(k) ?? 0) + 1) }
          return [...map.entries()].sort((a, b) => b[1] - a[1])[0]
        })()
        lines.push(most ? `说得最多的是「${most[0]}」，${most[1]} 句。` : '有人在说话，但我没细记。')
      }
      if (first) {
        const t = hhmm(first.at)
        lines.push(`${t ? '最早是 ' + t + '，' : ''}「${String(first.who || '群友').slice(0, 12)}」先开的口。`)
      }
      if (last) {
        const t = hhmm(last.at)
        if (t) lines.push(`一直聊到 ${t}，我${last.origin === 'bot' ? '还接了最后一句' : '后面就没怎么吭声了'}。`)
      }
      if (promises.length) {
        lines.push(`我答应过：${promises.slice(-2).map((p) => String(p.text).slice(0, 30)).join('；')}。`)
      }
    }
    const lines6 = lines.slice(0, 6)
    const rec = { peerKey: pk, date, at: new Date().toISOString(), source: 'local', lines: lines6 }
    try { writeJson(fileOf(pk, date), rec) } catch (err) { return { ok: false, error: String(err?.message ?? err) } }
    audit('diary.write', { peer: pk.slice(0, 16), date, lines: lines6.length })
    return { ok: true, date, lines: lines6 }
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err) }
  }
}

/** 注入用的一行（≤80 字）：只给「上次日记」的引子，不给整篇 */
export function diaryHint(peerKey) {
  try {
    const d = latestDiary(peerKey)
    if (!d) return ''
    const line = String(d.lines[0] ?? '').slice(0, 80)
    if (!line) return ''
    return `# 我自己的日记（${d.date} 那天的第一句，只当背景）\n${line}`
  } catch { return '' }
}

/** 面板用：最近 n 篇 */
export function listDiary(peerKey, n = 7) {
  const out = []
  for (let i = 0; i < Math.max(1, Math.min(30, Number(n) || 7)); i++) {
    const d = dayStr(new Date(Date.now() - i * 86400000))
    const j = loadDiary(peerKey, d)
    if (j) out.push({ date: d, lines: j.lines, at: j.at, source: j.source })
  }
  return out
}
