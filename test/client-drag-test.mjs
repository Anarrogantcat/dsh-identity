import { readFileSync } from "node:fs";
// 极简 DOM stub：够 client.js 跑起来，验证拖动逻辑
const els = new Map();
function mkEl(tag) {
  const el = {
    tagName: tag.toUpperCase(), style: { setProperty(k, v) { this[k] = v } },
    dataset: {}, children: [], attributes: {}, listeners: {}, classList: {
      _s: new Set(), add(c) { this._s.add(c) }, remove(c) { this._s.delete(c) }, contains(c) { return this._s.has(c) },
    },
    textContent: '', title: '', id: '',
    appendChild(c) { this.children.push(c); if (c.id) els.set(c.id, c); return c },
    addEventListener(t, fn) { (this.listeners[t] ??= []).push(fn) },
    removeEventListener() {},
    setPointerCapture() {}, releasePointerCapture() {},
    querySelector(sel) { return mkFind(this, sel)[0] ?? mkEl('button') },
    querySelectorAll(sel) { return mkFind(this, sel) },
    getBoundingClientRect() { return { left: 100, top: 100, width: 46, height: 46, right: 146, bottom: 146 } },
    fire(type, ev = {}) { for (const fn of (this.listeners[type] ?? [])) fn({ preventDefault() {}, stopPropagation() {}, ...ev }) },
    innerHTML: '',
  }
  return el
}
function mkFind(root, sel) {
  const out = []
  const walk = (n) => {
    for (const c of n.children ?? []) {
      if (sel.startsWith('#')) { if (c.id === sel.slice(1)) out.push(c) }
      else if (sel.startsWith('[data-act=')) { const v = sel.slice(11, -2); if (c.dataset && c.dataset.act === v) out.push(c) }
      walk(c)
    }
  }
  walk({ children: [root] })
  if (sel.startsWith('#') && out.length === 0) {
    // 通过 innerHTML 创建的那批（wrap 里的按钮）简化处理：造一个假的
    const fake = mkEl('button'); fake.dataset.act = sel.slice(11, -2); return [fake]
  }
  return out
}
const head = mkEl('head'), body = mkEl('body')
const doc = {
  readyState: 'complete',
  head, body,
  createElement: (t) => mkEl(t),
  getElementById: (id) => { if (!els.has(id) && id === 'qqrefine-frame') els.set(id, mkEl('iframe')); return els.get(id) ?? null },
  querySelector: (s) => body.querySelector(s),
  addEventListener() {},
}
const store = new Map()
const win = {
  innerWidth: 1200, innerHeight: 800,
  document: doc,
  localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
  requestAnimationFrame: (fn) => setTimeout(fn, 0),
  cancelAnimationFrame: () => {},
  setTimeout, clearTimeout, console,
  addEventListener() {}, removeEventListener() {},
}
let mod = null
win.__ModuleLoader__ = { load: (m) => { mod = m } }
const src = readFileSync(new URL("../client.js", import.meta.url), "utf8")
new Function('window', 'localStorage', 'document', 'requestAnimationFrame', 'cancelAnimationFrame', src)(win, win.localStorage, doc, win.requestAnimationFrame, win.cancelAnimationFrame)
if (!mod || !mod.factory) { console.log("FAIL client 模块没注册"); process.exit(1) }
const api = mod.factory()
api.apply({})

const ok = []
const T = (n, c, e) => ok.push([n, !!c, e])
const tick = () => new Promise((r) => setTimeout(r, 5))
await new Promise((r) => setTimeout(r, 400))
const fab = els.get('qqrefine-fab')
const wrap = els.get('qqrefine-wrap')
T("挂上了悬浮按钮", !!fab && fab.textContent === '🐟', !!fab)
T("默认位置在右下", fab.style['--x'] === (1200 - 46 - 18) + 'px' && fab.style['--y'] === (800 - 46 - 18) + 'px', [fab.style['--x'], fab.style['--y']])
T("提示里写了可以拖", /拖/.test(fab.title), fab.title)

// 小位移（<5px）→ 当作点击
fab.fire('pointerdown', { button: 0, pointerType: 'mouse', pointerId: 1, clientX: 120, clientY: 120 })
fab.fire('pointermove', { pointerId: 1, clientX: 123, clientY: 123 })
fab.fire('pointerup', { pointerId: 1 })
fab.fire('click', {})
T("点一下会打开面板", wrap.dataset.open === '1', wrap.dataset.open)

// 拖动
fab.dataset.open = '0'
wrap.dataset.open = '0'
fab.fire('pointerdown', { button: 0, pointerType: 'mouse', pointerId: 2, clientX: 120, clientY: 120 })
fab.fire('pointermove', { pointerId: 2, clientX: 320, clientY: 260 })
await tick()
fab.fire('pointerup', { pointerId: 2 })
T("拖动后位置更新", fab.style['--x'] === '300px' && fab.style['--y'] === '240px', [fab.style['--x'], fab.style['--y']])
T("位置落盘", JSON.parse(store.get('qqrefine:fabPos') || '{}').x === 300, store.get('qqrefine:fabPos'))
fab.fire('click', {})
T("拖完不会误开面板", wrap.dataset.open === '0', wrap.dataset.open)

// 边界：拖出屏幕会被夹住
fab.fire('pointerdown', { button: 0, pointerType: 'mouse', pointerId: 3, clientX: 300, clientY: 240 })
fab.fire('pointermove', { pointerId: 3, clientX: 5000, clientY: 5000 })
await tick()
fab.fire('pointerup', { pointerId: 3 })
T("右/下越界被夹住", fab.style['--x'] === (1200 - 46 - 6) + 'px' && fab.style['--y'] === (800 - 46 - 6) + 'px', [fab.style['--x'], fab.style['--y']])
fab.fire('pointerdown', { button: 0, pointerType: 'mouse', pointerId: 4, clientX: 300, clientY: 240 })
fab.fire('pointermove', { pointerId: 4, clientX: -5000, clientY: -5000 })
await tick()
fab.fire('pointerup', { pointerId: 4 })
T("左/上越界被夹住", fab.style['--x'] === '6px' && fab.style['--y'] === '6px', [fab.style['--x'], fab.style['--y']])

console.log("=== 悬浮按钮拖动 测试 ===");
let fail = 0
for (const [n, pass, e] of ok) { console.log((pass ? "OK  " : "FAIL ") + n + (pass ? "" : "   " + JSON.stringify(e))); if (!pass) fail++ }
console.log(fail ? ("失败 " + fail + "/" + ok.length) : ("全部通过 " + ok.length + "/" + ok.length));
process.exit(fail ? 1 : 0);