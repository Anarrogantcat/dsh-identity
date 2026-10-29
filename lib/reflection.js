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
import { collectStream } from './llmtext.js'

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

/** 月复盘：把最近 30 天的日复盘汇总（只读，不新增存储） */
export function monthSummary(peerKey) {
  const list = listReflections(peerKey, 30)
  const inbound = list.reduce((a, x) => a + Number(x.metrics?.inbound ?? 0), 0)
  const mine = list.reduce((a, x) => a + Number(x.metrics?.mine ?? 0), 0)
  const overdue = list.reduce((a, x) => a + Number(x.metrics?.overdue ?? 0), 0)
  const open = list.reduce((a, x) => a + Number(x.metrics?.openPromises ?? 0), 0)
  return { days: list.length, inbound, mine, overdue, openPromises: open, ratio: inbound ? Number((mine / inbound).toFixed(2)) : 0 }
}

/** 模型写复盘：先跑本地拿指标，再让模型用人话重写；失败保留本地版 */
export async function reflectDayLlm(peerKey, cfg, llm, date = dayStr(), { force = false } = {}) {
  const pk = String(peerKey ?? '')
  if (!pk) return { ok: false, error: 'no peerKey' }
  const local = reflectDay(pk, date, { force })
  if (!local.ok || !llm?.stream) return local
  try {
    const evs = readEvents(pk, date).filter((e) => e.kind === 'talk')
    const digest = evs.slice(-60).map((e) => (e.origin === 'bot' ? '我' : '群友') + '：' + String(e.text || '').slice(0, 80)).join('\n')
    const prompt = [
      '你在以「大肥鱼」的第一人称写今天的小复盘，只根据下面的统计和对话，不要编。',
      '要求：3–4 句；口语；可以自省今天接话多了/少了、有没有答应没做到的事；不写列表标题；不提模型/工具/系统。',
      '输出纯文本，每行一句。',
      '统计：' + JSON.stringify(local.metrics || {}),
      digest,
    ].join('\n')
    const r2 = await collectStream(llm, { provider: String(cfg?.integration?.llmProvider || ''), model: String(cfg?.integration?.llmModel || ''), prompt, maxTokens: 300 })
    const lines = String(r2?.text || '').split(/\n+/).map((x) => x.replace(/^[-*\d.、\s]+/, '').trim()).filter((x) => x.length >= 4).slice(0, 5)
    if (!lines.length) return local
    const rec = { peerKey: pk, date, at: new Date().toISOString(), source: 'llm', lines, metrics: local.metrics }
    writeJson(fileOf(pk, date), rec)
    audit('reflection.write', { peer: pk.slice(0, 16), date, llm: true })
    return { ok: true, date, lines, metrics: local.metrics, llm: true }
  } catch { return local }
}
