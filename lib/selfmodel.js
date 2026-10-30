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

function snapshot(self) {
  try {
    const p = join(dirs.root, 'selfmodel-history.jsonl')
    const now = Date.now()
    let lastAt = 0
    if (existsSync(p)) { const lines = readFileSync(p, 'utf8').trim().split('\n').slice(-1)[0]; try { lastAt = Date.parse(JSON.parse(lines).at || 0) } catch { /* ignore */ } }
    if (now - lastAt < 6 * 3600000) return
    const summary = [self.mood, (self.changes || []).join('；'), (self.goals || []).join('；')].filter(Boolean).join('；').slice(0, 160)
    appendFileSync(p, JSON.stringify({ at: new Date(now).toISOString(), mood: self.mood, summary }) + '\n')
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
  try { const p = pace.snapshot(); out.energy = p.energy; out.last10 = p.last10 } catch { /* ignore */ }
  try { out.habits = durableLines({ limit: 4, maxChars: 200 }) || [] } catch { /* ignore */ }
  try {
    const items = listTraits({ limit: 80 }).filter((t) => t && t.status !== 'durable')
    out.changes = items.slice(-2).map((t) => String(t.text || '').slice(0, 40)).filter(Boolean)
  } catch { /* ignore */ }
  try { out.promises = openPromiseLines('', 3) || [] } catch { /* ignore */ }
  try { out.goals = (listGoals({ status: 'approved' }) || []).slice(0, 3).map((g) => String(g.title || g.why || '').slice(0, 40)).filter(Boolean) } catch { /* ignore */ }
  const parts = ['# 自我模型（连续的你，不是任务清单）']
  if (out.identity) parts.push('你是谁：' + out.identity)
  if (out.mood) parts.push('此刻：' + out.mood)
  if (out.regulation) parts.push('情绪调节：' + out.regulation)
  if (out.energy != null) parts.push('精力：' + Math.round(Number(out.energy) * 100) + '%（最近 10 分钟说了 ' + String(out.last10 || 0) + ' 句）')
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
