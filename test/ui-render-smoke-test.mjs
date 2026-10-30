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
const hook = ';window.__ui = { setState: (s) => { STATE = s }, setActive: (a) => { ACTIVE = a }, setCog: (c) => { COGSUB = c }, renderPanel, renderTabs, renderChips, renderTopbar };'
window.eval(script + hook)

const base = {
  ok: true, version: '1.3.2', configPath: 'x', configPathExists: true,
  config: { identity: {}, roles: { owners: [], admins: [] }, scope: { groups: [], dmUsers: [] }, tools: {}, mcp: { enabled: false, servers: [] }, frequency: {}, integration: {}, ui: {} },
  tabs: [['overview', '总览']],
  fields: [{ k: 'frequency.x', t: 'bool', l: '测试开关', tab: 'privacy' }],
  identity: {}, identityKernel: '你是大肥鱼', identityBase: '', identityGuards: '',
  traits: { items: [{ id: 't1', text: '例子', kind: 'self-say', status: 'tentative', hits: 1, firstSeen: new Date().toISOString(), confidence: 0.4 }], stats: { durable: 0, tentative: 1 } },
  mood: {}, moodV2: { seven: {}, needs: {}, blends: [], behavior: {}, stance: [] },
  promises: [], autonomy: { goals: [], by: {} }, reflection: { days: [] }, growth: { promises: { fulfillRate: 0 }, traits: { conflictRate: 0 } },
  usage: { totals: { yuan: 0 } }, sticker: {}, transport: {}, channels: [], capabilitiesList: [], lifeparams: { values: {} },
  memoryPage: { diary: [], reflections: [], memory: [] }, roles: {}, recentPeers: [],
  compat: {
    at: '2026-10-31T00:00:00.000Z', plugin: '1.9.195', ok: true,
    verified: { dsh: '0.2.1-rc.5', at: '2026-10-31' },
    env: { dsh: '0.2.1-rc.5', source: 'x/app.asar', electron: '44.7.0', node: '24.19.0', platform: 'win32-x64' },
    checks: [
      { key: 'dshVersion', label: '宿主版本', level: 'ok', note: 'DSH 0.2.1-rc.5（实测过）' },
      { key: 'toolRegister', label: '工具注册', level: 'warn', note: '还没建过 QQ 会话' },
      { key: 'dataDir', label: '数据目录可写', level: 'ok', note: 'C:/tmp' },
    ],
  },
}

const tabs = [
  ['overview', null], ['identity', null], ['memory', null], ['proactive', null],
  ['privacy', null], ['usage', null], ['sticker', null], ['draw', null], ['voice', null], ['bili', null],
  ['about', null], ['cognition', 'knowledge'], ['qq', null], ['scope', null], ['channel', null], ['order', null], ['freq', null],
  ['system', null],
  ['cognition', 'mood'], ['cognition', 'profile'], ['cognition', 'memory'], ['cognition', 'relations'],
]
const fails = []
for (const [tab, cog] of tabs) {
  try {
    window.__ui.setState(JSON.parse(JSON.stringify(base)))
    window.__ui.setActive(tab)
  try { window.__ui.renderChips() } catch (e) { fails.push('renderChips 抛错 ' + tab + ': ' + e.message); continue }
    if (cog) window.__ui.setCog(cog)
    window.__ui.renderPanel()
    const panel = window.document.getElementById('panel')
  const cogNavs = panel ? panel.querySelectorAll('.cog-nav').length : 0
  if (cogNavs > 1) fails.push('cog-nav 重复 ' + tab + ' x' + cogNavs)
    const out = panel ? String(panel.innerHTML || '') : ''
    if (!out.trim()) throw new Error('空白')
    if (/undefined|NaN/.test(out)) throw new Error('输出含 undefined/NaN')
  } catch (e) {
    fails.push((cog ? tab + '/' + cog : tab) + ': ' + (e && e.message ? e.message : e))
  }
}

// 关于页：兼容自检卡片要真渲染出来（有 compat 数据时，不是兜底文案）
try {
  window.__ui.setState(JSON.parse(JSON.stringify(base)))
  window.__ui.setActive('about')
  window.__ui.renderPanel()
  const out = String(window.document.getElementById('panel').innerHTML || '')
  if (!out.includes('兼容自检')) fails.push('关于页缺兼容自检卡片')
  if (!out.includes('0.2.1-rc.5')) fails.push('兼容卡片没显示宿主版本')
  if (!out.includes('✓') || !out.includes('!')) fails.push('兼容卡片没画通过/待办标记')
} catch (e) { fails.push('关于页兼容卡片: ' + (e && e.message ? e.message : e)) }

console.log('=== UI 渲染冒烟 ===')
if (fails.length) { for (const f of fails) console.log('FAIL ' + f); console.log('失败 ' + fails.length + '/' + tabs.length); process.exit(1) }
console.log('全部通过 ' + tabs.length + ' 页')
process.exit(0)
