/**
 * 反思（L2）：只吃事实流 events 与承诺，不读她自己写的日记（防自我强化）。
 *
 * 产出：每天一份短复盘（3–5 条），只存档 + 面板/审计可看，不注入提示词。
 * 用处：周/月复盘、成长指标（兑现率/逾期数）的原始素材；模型不能自己改判，Owner 可看可清。
 */
import { join } from 'node:path'
import { readJson, writeJson, dirs, audit } from './store.js'
import { readEvents } from './events.js'
import { listPromises } from './promises.js'
import { dayStr } from './diary.js'

const dirOf = (peerKey) => join(dirs.root, 'reflections', String(peerKey))
const fileOf = (peerKey, date) => join(dirOf(peerKey), `${date}.json`)

export function loadReflection(peerKey, date = dayStr()) {
  const j = readJson(fileOf(peerKey, date), null)
  if (!j || !Array.isArray(j.lines)) return null
  return { peerKey: String(peerKey), date, ...j }
}

/**
 * 当天复盘（本地、0 token）。
 * @returns {{ok:boolean, date:string, lines:string[], metrics?:object, skipped?:boolean, error?:string}}
 */
export function reflectDay(peerKey, date = dayStr(), { force = false } = {}) {
  const pk = String(peerKey ?? '')
  if (!pk) return { ok: false, error: 'no peerKey' }
  if (!force) {
    const old = loadReflection(pk, date)
    if (old) return { ok: true, date, lines: old.lines, metrics: old.metrics, skipped: true }
  }
  try {
    const evs = readEvents(pk, date)
    const talks = evs.filter((e) => e.kind === 'talk')
    const mine = talks.filter((e) => e.origin === 'bot')
    const theirs = talks.filter((e) => e.origin === 'inbound')
    const overdue = listPromises({ status: 'open', peerKey: pk }).filter((x) => x.overdue)
    const allOpen = listPromises({ status: 'open', peerKey: pk })
    const lines = []
    lines.push(`群里 ${theirs.length} 句、我 ${mine.length} 句；${mine.length === 0 ? '我基本没接话。' : '接话比大约 ' + (theirs.length ? (mine.length / theirs.length).toFixed(2) : '—') + '。'}`)
    if (allOpen.length) {
      lines.push(`还有 ${allOpen.length} 件答应的事没做完${overdue.length ? '（其中 ' + overdue.length + ' 件逾期）' : ''}。`)
    } else {
      lines.push('答应过的事都清掉了。')
    }
    if (overdue.length) lines.push(`明天先补：「${overdue[0].text.slice(0, 40)}」。`)
    else if (theirs.length >= 10 && mine.length < Math.max(1, Math.floor(theirs.length * 0.05))) lines.push('群里话不少，我回得太少了，明天有人问就接一句。')
    else lines.push('节奏正常，别为了刷存在感硬接。')
    if (talks.length) {
      const last = talks[talks.length - 1]
      if (last?.at) lines.push('最后一条到 ' + new Date(last.at).toTimeString().slice(0, 5) + '。')
    }
    const metrics = { inbound: theirs.length, mine: mine.length, openPromises: allOpen.length, overdue: overdue.length }
    const rec = { peerKey: pk, date, at: new Date().toISOString(), lines: lines.slice(0, 5), metrics }
    writeJson(fileOf(pk, date), rec)
    audit('reflection.write', { peer: pk.slice(0, 16), date })
    return { ok: true, date, lines: rec.lines, metrics }
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err) }
  }
}

/** 最近 n 天复盘（面板/周报素材） */
export function listReflections(peerKey, n = 7) {
  const out = []
  for (let i = 0; i < Math.max(1, Math.min(30, Number(n) || 7)); i++) {
    const d = dayStr(new Date(Date.now() - i * 86400000))
    const j = loadReflection(peerKey, d)
    if (j) out.push({ date: d, lines: j.lines, metrics: j.metrics })
  }
  return out
}

/** 周复盘（只读汇总，不改状态） */
export function weekSummary(peerKey) {
  const list = listReflections(peerKey, 7)
  const inbound = list.reduce((a, x) => a + Number(x.metrics?.inbound ?? 0), 0)
  const mine = list.reduce((a, x) => a + Number(x.metrics?.mine ?? 0), 0)
  const overdue = list.reduce((a, x) => a + Number(x.metrics?.overdue ?? 0), 0)
  return { days: list.length, inbound, mine, overdue, ratio: inbound ? Number((mine / inbound).toFixed(2)) : 0 }
}
