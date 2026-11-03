/** 自我模型：把身份、稳定习惯、当前情绪、承诺、最近变化压成一段连续的“我是谁” */
import { kernelText } from './identity.js'
import { loadConfig } from './config.js'
import { listTraits, durableLines, traitsStats } from './traits.js'
import * as moodv2 from './moodv2.js'
import { openPromiseLines } from './promises.js'
import { listGoals } from './autonomy.js'
import * as pace from './pace.js'
import { join } from 'node:path'
import { readFileSync, appendFileSync, existsSync } from 'node:fs'
import { dirs } from './store.js'

/** 实质变化：变了什么才算长进，光心情换张脸不算 */
function substanceOf(o) {
  return [o.changes || [], o.goals || [], o.promises || []].map((a) => a.join('；')).join('|')
}

function snapshot(self) {
  try {
    const p = join(dirs.root, 'selfmodel-history.jsonl')
    const now = Date.now()
    let prev = null
    if (existsSync(p)) {
      const lines = readFileSync(p, 'utf8').trim().split('\n').slice(-1)[0]
      try { prev = JSON.parse(lines) } catch { prev = null }
    }
    if (now - (Date.parse(prev?.at || 0) || 0) < 6 * 3600000) return
    const curSub = substanceOf(self)
    // 写不出「跟上次比改了什么」就不存：连续自我不是复读同一句
    if (prev) {
      if (!curSub) return
      if (String(prev.substance ?? '') === curSub) return
    }

    const delta = []
    if (prev?.mood && prev.mood !== self.mood) delta.push('情绪从「' + prev.mood + '」变成「' + self.mood + '」')
    const body = []
    if ((self.changes || []).length) body.push('在变的地方：' + self.changes.join('；'))
    if ((self.goals || []).length) body.push('在推进：' + self.goals.join('；'))
    if ((self.promises || []).length) body.push('还答应着：' + self.promises.join('；'))
    const head = prev ? '跟上次比：' + (delta.length ? delta.join('，') : '实质没变') + '；' : ''
    const summary = (head + body.join('；')).slice(0, 220) || String(self.mood || '')
    const substance = curSub || summary
    appendFileSync(p, JSON.stringify({ at: new Date(now).toISOString(), mood: self.mood, summary, substance }) + '\n')
  } catch { /* ignore */ }
}

function historyLines() {
  try {
    const p = join(dirs.root, 'selfmodel-history.jsonl')
    if (!existsSync(p)) return []
    return readFileSync(p, 'utf8').trim().split('\n').slice(-3).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  } catch { return [] }
}

export function buildSelfModel() {
  const out = { identity: '', mood: '', habits: [], changes: [], promises: [], text: '' }
  try {
    // 自定义内核优先：身份段用的就是它，自我模型不能还说内置那套
    const base = String(loadConfig()?.identity?.baseText ?? '').trim()
    out.identity = String(base || kernelText()).slice(0, 260)
  } catch { /* ignore */ }
  try {
    const ms = moodv2.summary()
    out.mood = String((ms.topSeven && ms.topSeven[0]) || '平稳') + (ms.blends && ms.blends.length ? (' / ' + ms.blends.join(' / ')) : '')
  } catch { /* ignore */ }
  try { out.regulation = moodv2.regulationText() } catch { /* ignore */ }
  try { const p = pace.snapshot(); out.energy = p.energy; out.last10 = p.last10; out.tone = p.tone; out.tired = p.tired } catch { /* ignore */ }
  try { out.habits = durableLines({ limit: 4, maxChars: 200 }) || [] } catch { /* ignore */ }
  try {
    // 「在变的地方」要说的是真变化：教训、行为经验，或者像自我描述的话。
    // 对话残句（「我这边命令行起不来了」）和自问自答的噪音不该混进来。
    const SELF_DESC = /(我|本鱼)[^，。；]{0,12}(喜欢|习惯|讨厌|不会|总是|不爱|怕|擅长|受不了|记得|学到|明白|发现)/
    const items = listTraits({ limit: 120 }).filter((t) => {
      if (!t || t.status === 'durable') return false
      const s = String(t.text || '').trim()
      if (s.length < 8) return false
      if (/[?？]/.test(s)) return false
      if (/把「.*」这事弄明白/.test(s)) return false
      // 「还没弄明白」是待办，不是「在变」——别把没搞懂的事当成自己的变化
      if (/没弄明白|不知道|没查到|没准信|不确定|还没弄懂/.test(s)) return false
      if (t.kind === 'feedback' || t.kind === 'decision') return true
      return SELF_DESC.test(s)
    })
    out.changes = items.slice(-2).map((t) => String(t.text || '').slice(0, 40)).filter(Boolean)
  } catch { /* ignore */ }
  try { out.promises = openPromiseLines('', 3) || [] } catch { /* ignore */ }
  try { out.goals = (listGoals({ status: 'approved' }) || []).slice(0, 3).map((g) => String(g.title || g.why || '').slice(0, 40)).filter(Boolean) } catch { /* ignore */ }
  const parts = ['# 自我模型（连续的你，不是任务清单）']
  if (out.identity) parts.push('你是谁：' + out.identity)
  if (out.mood) parts.push('此刻：' + out.mood)
  // 时间感：人知道自己现在是下午还是深夜，说话会不一样
  try {
    const d = new Date()
    const h = d.getHours()
    const period = h < 5 ? '凌晨' : h < 9 ? '早上' : h < 12 ? '上午' : h < 14 ? '中午' : h < 18 ? '下午' : h < 23 ? '晚上' : '深夜'
    const late = h >= 23 || h < 6
    parts.push('时间：现在是' + period + '，' + h + ' 点' + (late ? '——这个点通常该犯困了' : ''))
  } catch { /* ignore */ }
  if (out.regulation) parts.push('情绪调节：' + out.regulation)
  if (out.energy != null) {
    // 干活模式：精力只记录、不压活。写插件/做工程时不该因为「累」而缩短输出、省工具。
    const workMode = (() => { try { return loadConfig()?.frequency?.workMode === true } catch { return false } })()
    // 干活模式只压「工作力度」，不压「说话方式」：会累仍要体现在话短上
    const toneText = pace.toneHint(out.tone, { workMode })
    parts.push('精力：' + Math.round(Number(out.energy) * 100) + '%，' + toneText + '（最近 10 分钟说了 ' + String(out.last10 || 0) + ' 句' + (out.tired ? '；今天硬撑着回了 ' + out.tired + ' 次' : '') + '）')
  }
  if (out.habits.length) parts.push('已经稳定的习惯：' + out.habits.join('；'))
  if (out.changes.length) parts.push('最近在变的地方：' + out.changes.join('；'))
  if (out.promises.length) parts.push('还答应着的事：' + out.promises.join('；'))
  if (out.goals && out.goals.length) parts.push('你自己在推进的事：' + out.goals.join('；'))
  try { const h = historyLines(); const prev = h[h.length - 1]; if (prev && prev.summary) parts.push('上次的我：' + String(prev.summary).slice(0, 160)) } catch { /* ignore */ }
  out.text = parts.join('\n').slice(0, 720)
  snapshot(out)
  return out
}

export function selfModelText() { try { return buildSelfModel().text } catch { return '' } }

export function history(limit = 5) {
  try { return historyLines().slice(-Math.max(1, Number(limit) || 5)).reverse().map((x) => ({ at: x.at, mood: x.mood || '', summary: x.summary || '' })) } catch { return [] }
}
