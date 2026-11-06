// 多人聊天：合并窗口 + 话题卡（本地规则）
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'

const base = pathToFileURL(join(process.cwd(), 'lib')).href + '/'
const { createBatcher, topicCard, topicWords } = await import(base + 'topical.js')

const ok = []
const T = (n, c, e) => ok.push([n, !!c, e])

// ── 合并窗口 ──
let flushed = []
const timers = []
const b = createBatcher({
  windowMs: 600,
  onBatch: (peer, items) => flushed.push([peer, items.map((x) => x.text)]),
  timer: (fn) => { timers.push(fn); return timers.length - 1 },
  clear: () => {},
})
T('第一条 push 返回 true', b.push('g1', { text: 'a' }) === true)
T('第二条同群 false（进同一批）', b.push('g1', { text: 'b' }) === false)
T('第三批不同群独立', b.push('g2', { text: 'c' }) === true)
T('窗口内未派发', flushed.length === 0, flushed)
timers[0]()
T('窗口到期派发一批', flushed.length === 1 && flushed[0][1].length === 2, flushed)
T('派发后待处理清零', b.pending('g1') === 0)
b.flushAll()
T('flushAll 不重复派发已清空的批', flushed.filter(([p]) => p === 'g1').length === 1, flushed)

// ── 话题卡 ──
T('不足 3 条不出卡', topicCard([{ nick: 'A', text: '打本吗' }]) === '')
T('3 条以上出卡', (() => {
  const c = topicCard([
    { nick: '染喵', text: '今晚打深渊吗' },
    { nick: '穿云', text: '深渊这期好难打' },
    { nick: '染喵', text: '深渊配队我看看' },
  ])
  return c.includes('现在群里') && c.includes('染喵')
})(), topicCard([{ nick: 'a', text: '深渊配队' }]))
T('话题卡不超过 120 字', (() => {
  const many = Array.from({ length: 30 }, (_, i) => ({ nick: 'n' + i, text: '深渊配队攻略角色面板圣遗物词条' }))
  return topicCard(many).length <= 120
})())
T('空消息不出卡', topicCard([{ nick: 'A', text: '   ' }, { nick: 'B', text: '' }, { nick: 'C', text: '' }]) === '')
T('话题词去掉寒暄', (() => {
  const w = topicWords('哈哈这个深渊怎么打')
  return !w.includes('哈哈') && !w.includes('这个')
})(), topicWords('哈哈这个深渊怎么打'))

let bad = 0
for (const [n, pass, e] of ok) { if (pass) console.log('OK   ' + n); else { bad++; console.log('FAIL ' + n + '  ' + String(JSON.stringify(e)).slice(0, 140)) } }
console.log(bad ? ('失败 ' + bad) : '全部通过')
process.exit(bad ? 1 : 0)
