/**
 * 判断卡「记人」验收口径测试：口径写死在脚本里，别被人悄悄改宽。
 *
 * 三件事：
 *   1. 只算 judge.js 蒸馏的卡——压缩摘要/今日复盘虽然也是 origin=agent，但那是「事」不是「人」
 *   2. 一轮里关于人的 ≥50% 且技术细节 ≤1 条才算达标
 *   3. 按 createdAt 间隔切轮：5 分钟内算同一轮，换 peer 另开一轮
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOME = mkdtempSync(join(tmpdir(), 'dsh-jq-'))
process.env.DSH_HOME = HOME
delete process.env.QQBOT_REFINE_HOME

const url = (p) => new URL(p, import.meta.url).href
const Q = await import(url('../scripts/judge-quality.mjs'))

const ok = []
const T = (n, p, d) => ok.push([n, !!p, d])
const at = (h, m) => `2026-11-03T0${h}:${String(m).padStart(2, '0')}:00.000Z`
const card = (category, { source = 'judge', peer = 'g1', at: t = at(4, 0) } = {}) => ({ peer, category, source, at: t, text: 'x' })

// 一：只算 judge
{
  const all = [card('preference'), card('event', { source: 'compact' }), card('event', { source: 'diary' })]
  T('只算 judge 判断卡', Q.judgeCards(all).length === 1, Q.judgeCards(all).length)
}

// 二：达标口径
{
  const g = Q.gradeRound([card('preference'), card('relation'), card('fact'), card('event')])
  T('一半是人就达标', g.person === 2 && g.n === 4 && g.pass === true, g)
}
{
  const g = Q.gradeRound([card('preference'), card('event'), card('event')])
  T('人不到一半不达标', g.person === 1 && g.pass === false, g)
}
{
  const g = Q.gradeRound([card('preference'), card('preference'), card('event'), card('event')])
  T('技术超过一条不达标', g.person === 2 && g.tech === 2 && g.pass === false, g)
}
{
  const g = Q.gradeRound([])
  T('空轮不算达标', g.pass === false, g)
}

// 三：按轮切
{
  const items = [
    card('preference', { at: at(4, 0) }),
    card('preference', { at: at(4, 2) }),
    card('preference', { at: at(4, 20) }),
    card('preference', { at: at(4, 21), peer: 'g2' }),
  ]
  const bs = Q.splitBatches(items)
  T('五分钟内算同一轮', bs.length === 3 && bs[0].items.length === 2, bs.map((b) => b.items.length))
  T('换 peer 另开一轮', bs[2].peer === 'g2' && bs[2].items.length === 1, bs.map((b) => b.peer))
}

// 四：混合夹具出的结论
{
  const items = Q.judgeCards([
    card('preference', { at: at(4, 0) }),
    card('preference', { at: at(4, 1) }),
    card('preference', { at: at(5, 0) }),
    card('event', { at: at(5, 1) }),
    card('event', { at: at(5, 2) }),
    card('event', { source: 'diary', at: at(6, 0) }),
  ])
  const bs = Q.splitBatches(items)
  const grades = bs.map((b) => Q.gradeRound(b.items))
  T('两轮一好一坏', bs.length === 2 && grades[0].pass === true && grades[1].pass === false, grades)
}

console.log('=== 判断卡记人验收 测试 ===')
let fail = 0
for (const [n, p, d] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d))); if (!p) fail++ }
console.log(fail ? `失败 ${fail}` : '全部通过')
try { rmSync(HOME, { recursive: true, force: true }) } catch { /* ignore */ }
process.exitCode = fail ? 1 : 0
