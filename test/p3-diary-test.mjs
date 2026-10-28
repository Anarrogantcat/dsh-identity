/**
 * P3 日记测试：只吃事件、3–6 句、幂等、注入只给一句
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOME = mkdtempSync(join(tmpdir(), 'dsh-p3-'))
process.env.DSH_HOME = HOME
delete process.env.QQBOT_REFINE_HOME

const url = (p) => new URL(p, import.meta.url).href
const D = await import(url('../lib/diary.js'))
const E = await import(url('../lib/events.js'))
const { ensureStore } = await import(url('../lib/config.js'))
const { ensureDirs, peerKey } = await import(url('../lib/store.js'))
ensureStore()
ensureDirs()

const ok = []
const A = (n, p, d) => ok.push([n, !!p, d])
const PK = peerKey('group', 'G1')
const date = D.dayStr()

// 空群：也写 2 句（不编内容）
{
  const r = D.generate(PK, date)
  A('空群也能写', r.ok && r.lines.length >= 2, r)
  A('空群不编人', r.lines.join('').includes('安安静静'))
}

// 有事件：句数 3–6、含真实数字/人名、幂等
{
  rmSync(join(HOME, 'storages'), { recursive: true, force: true })
  ensureStore(); ensureDirs()
  E.appendEvent(PK, { kind: 'talk', origin: 'inbound', who: '小明', text: '大肥鱼在吗', at: `${date}T10:00:00+08:00` })
  E.appendEvent(PK, { kind: 'talk', origin: 'bot', who: '我', text: '在的', at: `${date}T10:00:05+08:00` })
  E.appendEvent(PK, { kind: 'talk', origin: 'inbound', who: '小明', text: '今天聊什么', at: `${date}T11:00:00+08:00` })
  E.appendEvent(PK, { kind: 'talk', origin: 'inbound', who: '小红', text: '说她记得我', at: `${date}T12:00:00+08:00` })
  E.appendEvent(PK, { kind: 'promise', origin: 'bot', who: '我', text: '帮你查版本号', at: `${date}T12:00:10+08:00` })
  const r = D.generate(PK, date)
  A('有事件写出 3–6 句', r.ok && r.lines.length >= 3 && r.lines.length <= 6, r.lines.length)
  const txt = r.lines.join('\n')
  A('写了真实句数', txt.includes('3 句话') && txt.includes('1 句'), txt)
  A('写了真实人名', txt.includes('小明'), txt)
  A('写了承诺', txt.includes('答应过') && txt.includes('版本号'), txt)
  A('第一人称', txt.includes('我'))
  const again = D.generate(PK, date)
  A('同一天幂等（不重写）', again.skipped === true && again.lines.join('\n') === txt, again)
}

// 注入只给一句，不给整篇
{
  const hint = D.diaryHint(PK)
  A('注入只有第一句', hint.includes('日记') && hint.length < 200 && !hint.includes('小红'), hint)
  A('没有日记就不注入', D.diaryHint(peerKey('group', 'G-NONE')) === '')
  A('面板能列', D.listDiary(PK, 3).length === 1)
}

console.log('=== P3 日记测试 ===')
let fail = 0
for (const [n, p, d] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d))); if (!p) fail++ }
console.log(fail ? `失败 ${fail}` : '全部通过')
try { rmSync(HOME, { recursive: true, force: true }) } catch { /* ignore */ }
process.exitCode = fail ? 1 : 0
