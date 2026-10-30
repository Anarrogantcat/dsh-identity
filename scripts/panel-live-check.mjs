/**
 * 临时脚本（不入库）：拿真面板 HTML + 真 state，走 jsdom 真点击，看按钮是不是真绑上了。
 * 只点安全按钮（检查/刷新/自检这类），写操作的只验证有 onclick，不点。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JSDOM } from 'jsdom'

const BASE = process.argv[2] || 'http://127.0.0.1:63671'
const html = readFileSync(new URL('../panel.html', import.meta.url), 'utf8')
const dom = new JSDOM(html, { url: BASE + '/qqbot-refine', runScripts: 'outside-only', pretendToBeVisual: true })
const { window } = dom
let fetchCount = 0
const wire = (p) => {
  if (typeof p !== 'string') return Promise.reject(new Error('bad path'))
  if (p.startsWith('data:')) return Promise.resolve({ ok: true, json: async () => ({}) })
  const u = p.startsWith('http') ? p : BASE + p
  fetchCount += 1
  return fetch(u)
}
window.fetch = wire
window.scrollTo = () => {}
window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1]
const hook = ';window.__ui = { load, renderPanel, setActive: (a) => { ACTIVE = a }, setCog: (c) => { COGSUB = c }, getState: () => STATE, getDraft: () => draft, renderChips };'
window.eval(script + hook)

const fails = []
const safeIds = ['compatBtn', 'assetsReload', 'kbRefreshList', 'matchesReload', 'moodrefresh', 'orderAuditRefresh', 'rreload', 'topicsReload', 'trReload', 'voiceProbe', 'cardsGo', 'esportsToday', 'h2hGo']
const results = { clicked: [], skipped: [], handlers: 0, pages: 0 }

const tabs = [
  ['overview', null], ['identity', null], ['memory', null], ['proactive', null], ['privacy', null],
  ['usage', null], ['sticker', null], ['draw', null], ['voice', null], ['bili', null], ['about', null],
  ['cognition', 'knowledge'], ['qq', null], ['scope', null], ['channel', null], ['order', null], ['freq', null],
  ['system', null], ['cognition', 'mood'], ['cognition', 'profile'], ['cognition', 'memory'], ['cognition', 'relations'],
]

try {
  await window.__ui.load()
} catch (e) { fails.push('load(): ' + e.message) }
const st = window.__ui.getState()
if (!st || st.ok !== true) fails.push('state 没读到')
const diskVer = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
if (st?.version !== diskVer) fails.push('版本不是 ' + diskVer + '（实际 ' + st?.version + '）')
if (!Array.isArray(st?.compat?.checks) || st.compat.checks.length !== 6) fails.push('compat 检查项不是 6 条：' + (st?.compat?.checks || []).length)

for (const [tab, cog] of tabs) {
  try {
    window.__ui.setActive(tab)
    if (cog) window.__ui.setCog(cog)
    window.__ui.renderPanel()
    await new Promise((r) => setTimeout(r, 300)) // 有的页是 async 渲染，绑定在 await 之后
    const el = window.document.getElementById('panel')
    const out = String(el?.innerHTML || '')
    results.pages += 1
    if (!out.trim()) fails.push((cog ? tab + '/' + cog : tab) + ': 空白')
    if (/undefined|NaN/.test(out)) fails.push((cog ? tab + '/' + cog : tab) + ': 出现 undefined/NaN')
    const btns = [...el.querySelectorAll('button')]
    for (const b of btns) {
      const id = b.id || ''
      const has = typeof b.onclick === 'function'
      if (has) results.handlers += 1
      if (id && !has) fails.push((cog ? tab + '/' + cog : tab) + ' #' + id + ' 没绑 onclick')
      if (id && safeIds.includes(id) && has && !results.clicked.includes(id)) {
        try {
          b.click()
          await new Promise((r) => setTimeout(r, 700))
          results.clicked.push(id)
        } catch (e) { fails.push('点击 #' + id + ' 抛错: ' + e.message) }
      } else if (id && !safeIds.includes(id) && has) {
        results.skipped.push(id)
      }
    }
  } catch (e) { fails.push((cog ? tab + '/' + cog : tab) + ': ' + e.message) }
}

// 兼容卡片：重新自检按钮要真发请求、真更新提示
try {
  window.__ui.setActive('about')
  window.__ui.renderPanel()
  const before = fetchCount
  const btn = window.document.getElementById('compatBtn')
  if (!btn) fails.push('关于页找不到 #compatBtn')
  else {
    btn.click()
    await new Promise((r) => setTimeout(r, 1200))
    const msg = String(window.document.getElementById('compatMsg')?.textContent || '')
    if (fetchCount <= before) fails.push('重新自检没发 /state 请求')
    if (!msg.includes('已重新读取')) fails.push('重新自检提示没更新：' + JSON.stringify(msg))
    const html2 = String(window.document.getElementById('panel').innerHTML || '')
    if (!html2.includes('兼容自检')) fails.push('点完卡片不见了')
  }
} catch (e) { fails.push('兼容自检点击: ' + e.message) }

// 「人一点」按钮：要真的改草稿 + 提示 + 重绘
try {
  window.__ui.setActive('proactive')
  window.__ui.renderPanel()
  await new Promise((r) => setTimeout(r, 300))
  const btn = window.document.getElementById('proHumanize')
  if (!btn) fails.push('自主页找不到 #proHumanize')
  else if (typeof btn.onclick !== 'function') fails.push('#proHumanize 没绑 onclick')
  else {
    btn.click()
    await new Promise((r) => setTimeout(r, 100))
    const d = window.__ui.getDraft()
    const s = Number(d['proactive.silentMinutes'])
    const g = Number(d['proactive.minGapMinutes'])
    if (!(s >= 8 && s <= 16)) fails.push('人一点没写入安静值：' + s)
    if (!(g >= 30 && g <= 55)) fails.push('人一点没写入间隔值：' + g)
    const msg = String(window.document.getElementById('msg')?.textContent || '')
    if (!msg.includes('人一点')) fails.push('人一点没提示：' + JSON.stringify(msg))
  }
} catch (e) { fails.push('人一点点击: ' + e.message) }

console.log(JSON.stringify({ ok: fails.length === 0, pages: results.pages, handlers: results.handlers, clicked: results.clicked, skipped: [...new Set(results.skipped)], fetchCount, fails }, null, 2))
try { writeFileSync(join(tmpdir(), 'dsh-panel-live-result.json'), JSON.stringify({ ok: fails.length === 0, pages: results.pages, handlers: results.handlers, clicked: results.clicked, skipped: [...new Set(results.skipped)], fetchCount, fails }, null, 2)) } catch { /* ignore */ }
// 面板里有定时器，别让进程吊死
process.exit(fails.length ? 1 : 0)
