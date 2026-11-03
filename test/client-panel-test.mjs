/**
 * 侧栏入口注册测试（左侧栏那一版）。
 *
 * 旧的 client.js 是右下角 🐟 悬浮按钮，靠 DOM 拖动；现在换成 DSH 原生入口：
 *   · sidebar.panellist 注册 id=identity-panel，label「大肥鱼」，图标是 svg
 *   · main 注册同一个 key，点开在中间栏渲染标题条 + iframe(/qqbot-refine)
 * 这里不碰真 DOM，只验：两个槽位都注册了、id 对得上、组件能算出 iframe。
 */
import { readFileSync } from 'node:fs'

const ok = []
const T = (n, p, d) => ok.push([n, !!p, d])

// 够用的 React 桩：createElement / useState / Fragment
const React = {
  Fragment: 'Fragment',
  createElement(type, props, ...children) {
    const p = { ...(props || {}) }
    if (children.length) p.children = children.length === 1 ? children[0] : children
    return { type, props: p }
  },
  useState(init) {
    let v = typeof init === 'function' ? init() : init
    return [v, (next) => { v = typeof next === 'function' ? next(v) : next }]
  },
}

let mod = null
const win = { __ModuleLoader__: { load: (m) => { mod = m } } }
const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
new Function('window', src)(win)

T('模块注册了', !!mod && mod.id === 'dsh-identity', mod && mod.id)
const api = mod.factory((name) => (name === 'react' ? React : {}))
T('声明依赖 slots', Array.isArray(api.inject) && api.inject.includes('slots'), api.inject)

// 收集注册：inject(owner, cb) → cb() 返回 register(opts, comp) 的结果
const regs = []
const ctx = {
  slots: {
    inject(owner, cb) { regs.push({ owner, cb }) },
    register(opts, comp) { return { opts, comp } },
  },
}
api.apply(ctx)
const reg = (owner) => regs.find((r) => r.owner === owner)?.cb()

for (const r of regs) T('注册槽位 ' + r.owner, !!r.cb)

const side = reg('sidebar.panellist')
const main = reg('main')
T('侧栏入口存在的', !!side && !!main)

T('侧栏 id = identity-panel', side?.opts?.id === 'identity-panel', side?.opts)
T('侧栏 label = 大肥鱼', typeof side?.opts?.label === 'function' && side.opts.label() === '大肥鱼', side?.opts?.label?.())
T('侧栏有排序', Number.isFinite(side?.opts?.order), side?.opts?.order)
T('中间栏 key 对得上', main?.opts?.key === side?.opts?.id, main?.opts)

// 图标：给点尺寸，回来应该是 svg
const icon = side?.comp?.({ size: 16, active: false })
T('图标是 svg', icon?.type === 'svg', icon?.type)
T('图标跟尺寸走', icon?.props?.width === 16 && icon?.props?.height === 16, [icon?.props?.width, icon?.props?.height])

// 面板：标题条 + iframe
const panel = main?.comp?.({})
const findAll = (node, pred, out = []) => {
  if (!node || typeof node !== 'object') return out
  if (pred(node)) out.push(node)
  const kids = node.props?.children
  for (const k of Array.isArray(kids) ? kids : kids ? [kids] : []) findAll(k, pred, out)
  return out
}
const frames = findAll(panel, (n) => n.type === 'iframe')
T('面板里有 iframe', frames.length === 1, frames.length)
T('iframe 指向面板页', String(frames[0]?.props?.src || '').startsWith('/qqbot-refine'), frames[0]?.props?.src)
T('iframe 铺满不滚动', /idn-frame/.test(String(frames[0]?.props?.className || '')), frames[0]?.props?.className)

const texts = findAll(panel, (n) => n.type === 'span' || n.type === 'button')
  .map((n) => (Array.isArray(n.props.children) ? n.props.children.join('') : n.props.children))
  .filter((x) => typeof x === 'string')
T('标题栏写了名字', texts.some((t) => t.includes('大肥鱼')), texts)
T('有重新加载', texts.some((t) => t.includes('重新加载')), texts)
T('有新窗口打开', texts.some((t) => t.includes('新窗口')), texts)

console.log('=== 侧栏入口 测试 ===')
let fail = 0
for (const [n, p, d] of ok) {
  console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d)))
  if (!p) fail++
}
console.log(fail ? `失败 ${fail}/${ok.length}` : `全部通过 ${ok.length}/${ok.length}`)
process.exit(fail ? 1 : 0)
