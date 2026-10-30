/** 自我模型：把身份、稳定习惯、当前情绪、承诺、最近变化压成一段连续的“我是谁” */
import { kernelText } from './identity.js'
import { listTraits, durableLines, traitsStats } from './traits.js'
import * as moodv2 from './moodv2.js'
import { openPromiseLines } from './promises.js'
import { listGoals } from './autonomy.js'
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
    appendFileSync(p, JSON.stringify({ at: new Date(now).toISOString(), mood: self.mood, text: self.text.slice(0, 300) }) + '\n')
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
  try { out.identity = String(kernelText()).slice(0, 260) } catch { /* ignore */ }
  try {
    const ms = moodv2.summary()
    out.mood = String((ms.topSeven && ms.topSeven[0]) || '平稳') + (ms.blends && ms.blends.length ? (' / ' + ms.blends.join(' / ')) : '')
  } catch { /* ignore */ }
  try { out.regulation = moodv2.regulationText() } catch { /* ignore */ }
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
  if (out.habits.length) parts.push('已经稳定的习惯：' + out.habits.join('；'))
  if (out.changes.length) parts.push('最近在变的地方：' + out.changes.join('；'))
  if (out.promises.length) parts.push('还答应着的事：' + out.promises.join('；'))
  if (out.goals && out.goals.length) parts.push('你自己在推进的事：' + out.goals.join('；'))
  try { const h = historyLines(); if (h.length) parts.push('上次的我：' + String(h[h.length - 1].text || '').slice(0, 100)) } catch { /* ignore */ }
  out.text = parts.join('\n').slice(0, 700)
  snapshot(out)
  return out
}

export function selfModelText() { try { return buildSelfModel().text } catch { return '' } }
