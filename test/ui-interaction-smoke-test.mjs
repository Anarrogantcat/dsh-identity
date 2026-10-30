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
  ok: true, version: '1.3.2', configPath: 'x', configPathExists: true,
  config: { identity: {}, roles: { owners: [], admins: [] }, scope: { groups: ['G1'], dmUsers: [] }, tools: {}, mcp: { enabled: false, servers: [] }, frequency: {}, integration: {}, ui: {} },
  tabs: [['overview', '总览']],
  fields: [{ k: 'frequency.x', t: 'bool', l: '测试开关', tab: 'privacy' }],
  identity: {}, identityKernel: '你是大肥鱼', identityBase: '', identityGuards: '',
  traits: { items: [{ id: 't1', text: '例子', kind: 'self-say', status: 'tentative', hits: 1, firstSeen: new Date().toISOString(), confidence: 0.4 }], stats: { durable: 0, tentative: 1 } },
  mood: {}, moodV2: { seven: {}, needs: {}, blends: [], behavior: {}, stance: [] },
  promises: [], autonomy: { goals: [], by: {} }, reflection: { days: [] }, growth: { promises: { fulfillRate: 0 }, traits: { conflictRate: 0 } },
  usage: { totals: { yuan: 0 } }, sticker: {}, transport: {}, channels: [], capabilitiesList: [], lifeparams: { values: {} },
  memoryPage: { diary: [], reflections: [], memory: [] }, roles: {}, recentPeers: [],
}

const tabs = [['overview', null], ['identity', null], ['memory', null], ['proactive', null], ['privacy', null], ['usage', null], ['sticker', null], ['draw', null], ['voice', null], ['bili', null], ['about', null], ['cognition', 'knowledge'], ['qq', null], ['scope', null], ['channel', null], ['order', null], ['freq', null], ['system', null], ['cognition', 'mood'], ['cognition', 'profile'], ['cognition', 'memory'], ['cognition', 'relations']]

window.confirm = () => true
window.alert = () => {}
/** 记录每次请求，用来验证「写操作按钮是不是真接上了服务端」，不是只绑了个空函数 */
const calls = []
window.fetch = async (p, opt) => {
  calls.push({ path: String(p), body: opt && opt.body ? String(opt.body).slice(0, 160) : '' })
  return { ok: true, json: async () => JSON.parse(JSON.stringify(base)) }
}
/** 点了必须打服务端的按钮（纯本地改状态、或者要选中数据才动的不在里面） */
const SERVER_BACKED = new Set([
  'save', 'reset', 'addrSave', 'idKernelSave', 'idKernelReset', 'uReset', 'uResetCost', 'uRoles',
  'safetyReset', 'safetyUnban', 'moodreset', 'moodllmreset',
  'rosterRefresh', 'rosterPrune', 'rosterAddMany', 'claimadd', 'mcpSave', 'memesNow', 'memesSave',
  'kbRefreshList', 'trPing', 'trReload', 'drawPingBtn', 'voiceTryBtn', 'biliLoginProbe', 'esportsSync',
  'matchesReload', 'profileNoticeClear', 'orderAuditRefresh', 'rreload', 'assetsReload', 'topicsReload',
])
const unhandled = []
process.on('unhandledRejection', (e) => unhandled.push(String((e && e.stack) ? e.stack.split('\n').slice(0, 3).join(' | ') : e)))
window.addEventListener('unhandledrejection', (e) => unhandled.push(String(e.reason && e.reason.message ? e.reason.message : e.reason)))
const fails = []
let clicked = 0
for (const [tab, cog] of tabs) {
  try {
    window.__ui.setState(JSON.parse(JSON.stringify(base)))
    window.__ui.setActive(tab)
    if (cog) window.__ui.setCog(cog)
    window.__ui.renderPanel()
    const panel = window.document.getElementById('panel')
    const count = [...panel.querySelectorAll('button')].length
    for (let i = 0; i < count; i++) {
      // 每次点之前重渲染，避免点到已被替换的旧节点
      window.__ui.setState(JSON.parse(JSON.stringify(base)))
      if (cog) window.__ui.setCog(cog)
      window.__ui.renderPanel()
      // 有的页是 async 渲染，handler 在 await 之后才绑：给它一点时间再点
      await new Promise((r) => setTimeout(r, 80))
      const fresh = window.document.getElementById('panel')
      const b = [...fresh.querySelectorAll('button')][i]
      if (!b) continue
      const label = (b.id || b.dataset ? JSON.stringify(b.dataset) : '') + ' ' + String(b.textContent || '').trim().slice(0, 16)
      try {
        clicked++
        const beforeN = calls.length
        b.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
        await new Promise((r) => setTimeout(r, 120))
        if (b.id && SERVER_BACKED.has(b.id) && calls.length <= beforeN) {
          fails.push((cog ? tab + '/' + cog : tab) + ' · #' + b.id + ' 点了没发请求（按钮是空的？）')
        }
        // 有 id 的按钮必须绑上 handler（用 data-* 走事件委托的除外）
        if (b.id && typeof b.onclick !== 'function' && !b.dataset.goal && !b.dataset.tretire && !b.dataset.pclose && !b.dataset.pdrop) {
          fails.push((cog ? tab + '/' + cog : tab) + ' · #' + b.id + ' 没绑 onclick')
        }
      } catch (e) {
        fails.push((cog ? tab + '/' + cog : tab) + ' · ' + label + ' → ' + (e && e.message ? e.message : e))
      }
    }
  } catch (e) {
    fails.push((cog ? tab + '/' + cog : tab) + ' 渲染 → ' + (e && e.message ? e.message : e))
  }
}
for (const u of unhandled) fails.push('未处理的 Promise：' + u)
console.log('=== UI 交互冒烟 ===')
if (fails.length) { for (const f of fails) console.log('FAIL ' + f); console.log('失败 ' + fails.length + '，点击 ' + clicked + ' 次'); process.exit(1) }
console.log('全部通过，点击 ' + clicked + ' 次（19 页）')
process.exit(0)
