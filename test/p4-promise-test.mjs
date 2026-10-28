/**
 * P4 承诺/反思测试：只抓她自己的话、幂等、逾期、进接续包、复盘只吃事件
 */
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOME = mkdtempSync(join(tmpdir(), 'dsh-p4-'))
process.env.DSH_HOME = HOME
delete process.env.QQBOT_REFINE_HOME

const url = (p) => new URL(p, import.meta.url).href
const P = await import(url('../lib/promises.js'))
const R = await import(url('../lib/reflection.js'))
const D = await import(url('../lib/diary.js'))
const E = await import(url('../lib/events.js'))
const RES = await import(url('../lib/resume.js'))
const { ensureStore } = await import(url('../lib/config.js'))
const { ensureDirs, peerKey } = await import(url('../lib/store.js'))
ensureStore()
ensureDirs()

const ok = []
const A = (n, p, d) => ok.push([n, !!p, d])
const PK = peerKey('group', 'G1')
const date = D.dayStr()

// 抓承诺：只认她自己说的话
{
  A('承诺句式命中', P.notePromise(PK, '等下我帮你查一下版本号').ok === true)
  A('普通闲聊不记', P.notePromise(PK, '今天天气不错').ok === false)
  const dup = P.notePromise(PK, '等下我帮你查一下版本号')
  A('同句幂等', dup.dup === true)
  A('只记她说的（调用方限定 origin=bot）', P.listPromises({ status: 'open', peerKey: PK }).length === 1)
}

// 逾期：两天前就 overdue
{
  const old = new Date(Date.now() - 3 * 86400000).toISOString()
  P.notePromise(PK, '明天陪你练一局', { at: old })
  const list = P.listPromises({ status: 'open', peerKey: PK })
  A('逾期能识别', list.some((x) => x.text.includes('练一局') && x.overdue === true), list.map((x) => [x.text, x.overdue]))
  A('接续包带未完成承诺', RES.buildResumeBundle(PK).text.includes('还没做完的承诺'))
}

// 兑现
{
  const it = P.listPromises({ status: 'open', peerKey: PK }).find((x) => x.text.includes('查一下'))
  const r = P.closePromise(it.id, 'done')
  A('Owner 能标记兑现', r.ok && P.listPromises({ status: 'open', peerKey: PK }).every((x) => x.id !== it.id))
  A('兑现后不再进接续包', !RES.buildResumeBundle(peerKey('group', 'G-EMPTY')).text.includes('查一下'))
}

// 反思：只吃事件，不读日记；写出指标
{
  E.appendEvent(PK, { kind: 'talk', origin: 'inbound', who: '小明', text: '在吗', at: `${date}T10:00:00+08:00` })
  E.appendEvent(PK, { kind: 'talk', origin: 'bot', who: '我', text: '在', at: `${date}T10:01:00+08:00` })
  const r = R.reflectDay(PK, date)
  A('复盘有 3–5 条', r.ok && r.lines.length >= 3 && r.lines.length <= 5, r.lines)
  A('复盘统计真实句数', r.metrics.inbound === 1 && r.metrics.mine === 1, r.metrics)
  A('复盘提到逾期', r.lines.join('').includes('逾期') || r.metrics.overdue >= 1, r.lines)
  A('复盘幂等', R.reflectDay(PK, date).skipped === true)
  A('复盘不引用日记原文', !r.lines.join('').includes('安安静静'))
  const w = R.weekSummary(PK)
  A('周汇总能算', w.days >= 1 && w.inbound >= 1, w)
  A('只读文件存在', existsSync(join(HOME, 'storages', 'dsh-qqbot-refine', 'reflections')))
}

console.log('=== P4 承诺/反思测试 ===')
let fail = 0
for (const [n, p, d] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d))); if (!p) fail++ }
console.log(fail ? `失败 ${fail}` : '全部通过')
try { rmSync(HOME, { recursive: true, force: true }) } catch { /* ignore */ }
process.exitCode = fail ? 1 : 0
