/**
 * UI 渲染冒烟：用 jsdom 真跑面板脚本，逐页渲染，页面空白/抛错立刻失败。
 * 只测渲染，不发网络请求、不改数据。
 */
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'

const html = readFileSync(new URL('../panel.html', import.meta.url), 'utf8')
const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true })
const { window } = dom
window.fetch = () => new Promise(() => {})
window.scrollTo = () => {}
window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1]
const hook = ';window.__ui = { setState: (s) => { STATE = s }, setActive: (a) => { ACTIVE = a }, setCog: (c) => { COGSUB = c }, renderPanel, renderTabs, renderChips };'
window.eval(script + hook)

const base = {
  ok: true, version: '1.1.0', configPath: 'x', configPathExists: true,
  config: { identity: {}, roles: { owners: [], admins: [] }, scope: { groups: [], dmUsers: [] }, tools: {}, mcp: { enabled: false, servers: [] }, frequency: {}, integration: {}, ui: {} },
  tabs: [['overview', '总览']],
  fields: [{ k: 'frequency.x', t: 'bool', l: '测试开关', tab: 'privacy' }],
  identity: {}, identityKernel: '你是大肥鱼', identityBase: '', identityGuards: '',
  traits: { items: [{ id: 't1', text: '例子', kind: 'self-say', status: 'tentative', hits: 1, firstSeen: new Date().toISOString(), confidence: 0.4 }], stats: { durable: 0, tentative: 1 } },
  mood: {}, moodV2: { seven: {}, needs: {}, blends: [], behavior: {}, stance: [] },
  promises: [], autonomy: { goals: [], by: {} }, reflection: { days: [] }, growth: { promises: { fulfillRate: 0 }, traits: { conflictRate: 0 } },
  usage: { totals: { yuan: 0 } }, sticker: {}, transport: {}, channels: [], capabilitiesList: [], lifeparams: { values: {} },
  memoryPage: { diary: [], reflections: [], memory: [] }, roles: {}, recentPeers: [],
}

const tabs = [
  ['overview', null], ['identity', null], ['memory', null], ['proactive', null],
  ['privacy', null], ['usage', null], ['sticker', null], ['draw', null], ['voice', null],
  ['qq', null], ['scope', null], ['channel', null], ['order', null], ['freq', null],
  ['system', null],
  ['cognition', 'mood'], ['cognition', 'profile'], ['cognition', 'memory'], ['cognition', 'relations'],
]
const fails = []
for (const [tab, cog] of tabs) {
  try {
    window.__ui.setState(JSON.parse(JSON.stringify(base)))
    window.__ui.setActive(tab)
    if (cog) window.__ui.setCog(cog)
    window.__ui.renderPanel()
    const panel = window.document.getElementById('panel')
    const out = panel ? String(panel.innerHTML || '') : ''
    if (!out.trim()) throw new Error('空白')
    if (/undefined|NaN/.test(out)) throw new Error('输出含 undefined/NaN')
  } catch (e) {
    fails.push((cog ? tab + '/' + cog : tab) + ': ' + (e && e.message ? e.message : e))
  }
}
console.log('=== UI 渲染冒烟 ===')
if (fails.length) { for (const f of fails) console.log('FAIL ' + f); console.log('失败 ' + fails.length + '/' + tabs.length); process.exit(1) }
console.log('全部通过 ' + tabs.length + ' 页')
process.exit(0)
