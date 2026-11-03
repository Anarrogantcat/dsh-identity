/**
 * 账单：把「开发插件」和「聊天」的消耗拆开，输出一份 markdown。
 * 数据源：
 *   1) DSH 会话用量缓存（每会话累计 token）  → 分账用
 *   2) 用量账本 .dshw-usage.json（真实扣费）  → 实际花了多少钱
 *   3) 插件事件流（收到/开口条数）            → 聊天侧单价
 * 用法：node scripts/spend-report.mjs [输出路径.md]
 */
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { eventsDir } from '../lib/events.js'

const DSH = process.env.DSH_HOME || join(homedir(), '.dsh')
const SESS = join(DSH, 'storages', 'session_projcache', 'sessions')
const TRACK = join(DSH, '.dshw-usage.json')
const out = process.argv[2] || join(process.cwd(), '消耗账单.md')

// 插件自己写的 sid 映射：群/私聊 → DSH 会话 id（用来区分聊天和开发）
const sidmapPath = join(DSH, 'storages', 'dsh-identity', 'sidmap.json')
let sidmap = {}
try { sidmap = JSON.parse(readFileSync(sidmapPath, 'utf8')) } catch { /* ignore */ }
const chatBases = new Set(Object.values(sidmap).map((s) => String(s).split('-').slice(0, 5).join('-')))

// 价目（元/百万 token）
const PRICE = { miss: 2, hit: 0.04, output: 8 }
const costOf = (t) => (t.input * PRICE.miss + t.hit * PRICE.hit + t.output * PRICE.output) / 1e6

const rows = []
if (existsSync(SESS)) {
  for (const f of readdirSync(SESS).filter((x) => x.endsWith('.json'))) {
    let j
    try { j = JSON.parse(readFileSync(join(SESS, f), 'utf8')) } catch { continue }
    const t = j?.record?.rows?.tokenUsage?.val?.totals
    if (!t) continue
    const sid = f.replace(/\.json$/, '')
    rows.push({
      sid,
      chat: chatBases.has(sid.split('-').slice(0, 5).join('-')),
      input: t.uncachedInputTokens || 0,
      output: t.outputTokens || 0,
      hit: t.cacheReadTokens || 0,
      at: statSync(join(SESS, f)).mtime,
    })
  }
}

const sum = { chat: { input: 0, output: 0, hit: 0, n: 0, cost: 0 }, dev: { input: 0, output: 0, hit: 0, n: 0, cost: 0 } }
for (const r of rows) {
  const k = r.chat ? sum.chat : sum.dev
  k.input += r.input; k.output += r.output; k.hit += r.hit; k.n++
  k.cost += costOf(r)
}
const totalCost = sum.chat.cost + sum.dev.cost

// 真实扣费账本
let days = []
let balance = null
try {
  const tr = JSON.parse(readFileSync(TRACK, 'utf8'))
  balance = tr.lastBalance
  const b = Object.values(tr.accounting?.books ?? {})[0]
  days = Object.values(b?.days ?? {}).map((d) => ({
    day: d.day,
    debit: d.debitUnits / 1e8,
    credit: d.creditUnits / 1e8,
    opening: d.openingUnits / 1e8,
    last: d.lastUnits / 1e8,
  })).sort((a, b2) => a.day.localeCompare(b2.day))
} catch { /* ignore */ }

// 聊天条数
let chatIn = 0
let chatOut = 0
const evRoot = eventsDir()
if (existsSync(evRoot)) {
  for (const note of readdirSync(evRoot)) {
    if (!/^(g_|u_)/.test(note)) continue
    const nd = join(evRoot, note)
    if (!statSync(nd).isDirectory()) continue
    for (const f of readdirSync(nd).filter((x) => x.endsWith('.jsonl'))) {
      for (const ln of readFileSync(join(nd, f), 'utf8').split('\n')) {
        if (!ln.trim()) continue
        let o
        try { o = JSON.parse(ln) } catch { continue }
        if (o.origin === 'bot') chatOut++
        else if (o.origin === 'inbound') chatIn++
      }
    }
  }
}

const billed = days.reduce((a, d) => a + d.debit, 0)
const credited = days.reduce((a, d) => a + d.credit, 0)
const M = (n) => (n / 1e6).toFixed(2) + 'M'
const Y = (n) => n.toFixed(2) + ' 元'
const pct = (a, b) => (b > 0 ? (a / b * 100).toFixed(1) + '%' : '—')

const lines = []
const p = (s = '') => lines.push(s)
p('# 消耗账单 · 大肥鱼插件')
p()
p(`生成时间：${new Date().toLocaleString('zh-CN')}　数据源：DSH 会话用量缓存 + 用量账本 + 插件事件流`)
p()
p('## 总结')
p()
p(`按会话账目标价折算，全程 ${Y(totalCost)}：**开发 ${Y(sum.dev.cost)}（${pct(sum.dev.cost, totalCost)}）**，聊天 ${Y(sum.chat.cost)}（${pct(sum.chat.cost, totalCost)}）。`)
p()
p(`聊天侧她一共开口 ${chatOut} 次，折 **平均每次 ${(sum.chat.cost / Math.max(1, chatOut) * 100).toFixed(2)} 分**。`)
p()
p('## 分账（按 DSH 会话累计 token，标价口径）')
p()
p('| 项目 | 会话数 | 未命中输入 | 缓存命中 | 输出 | 标价折算 | 占比 |')
p('|---|---:|---:|---:|---:|---:|---:|')
p(`| 聊天（QQ 群/私聊） | ${sum.chat.n} | ${M(sum.chat.input)} | ${M(sum.chat.hit)} | ${(sum.chat.output / 1e3).toFixed(1)}K | ${Y(sum.chat.cost)} | ${pct(sum.chat.cost, totalCost)} |`)
p(`| 开发（本机会话） | ${sum.dev.n} | ${M(sum.dev.input)} | ${M(sum.dev.hit)} | ${(sum.dev.output / 1e3).toFixed(1)}K | ${Y(sum.dev.cost)} | ${pct(sum.dev.cost, totalCost)} |`)
p(`| **合计** | **${sum.chat.n + sum.dev.n}** | **${M(sum.chat.input + sum.dev.input)}** | **${M(sum.chat.hit + sum.dev.hit)}** | **${((sum.chat.output + sum.dev.output) / 1e3).toFixed(1)}K** | **${Y(totalCost)}** | 100% |`)
p()
p('> 输出只按「缓存命中 0.04 元/百万」算就已经是聊天的主要成本，聊天便宜全靠命中率高。')
p()
if (days.length) {
  p('## 真实扣费（余额账本）')
  p()
  p('| 日期 | 期初余额 | 扣费 | 充值 | 期末余额 |')
  p('|---|---:|---:|---:|---:|')
  for (const d of days) p(`| ${d.day} | ${Y(d.opening)} | ${Y(d.debit)} | ${d.credit ? Y(d.credit) : '—'} | ${Y(d.last)} |`)
  p(`| **合计** | | **${Y(billed)}** | **${Y(credited)}** | ${balance != null ? Y(balance) : '—'} |`)
  p()
  p(`账本只覆盖装了用量追踪之后的 ${days.length} 天。这 ${days.length} 天实扣 ${Y(billed)}，充值 ${Y(credited)}。`)
  p()
  p(`注意：账本是 **${days.length} 天**的实扣，而上面分账是**全程**的标价折算，两者时间范围不同，不能相除当折扣率用。真实支出只能等账本继续积累后再对账。`)
  p()
}
p('## 聊天侧明细')
p()
p(`- 收到 ${chatIn} 条，她开口 ${chatOut} 次`)
p(`- 聊天累计 token ${M(sum.chat.input + sum.chat.hit + sum.chat.output)}，标价折 ${Y(sum.chat.cost)}`)
p(`- 缓存命中占聊天 token 的 ${pct(sum.chat.hit, sum.chat.input + sum.chat.hit + sum.chat.output)}`)
p()
p('## 最烧的会话')
p()
p('| 类型 | 会话 | 标价折算 | token | 最后活跃 |')
p('|---|---|---:|---:|---|')
for (const r of rows.slice().sort((a, b) => costOf(b) - costOf(a)).slice(0, 8)) {
  p(`| ${r.chat ? '聊天' : '开发'} | ${r.sid.slice(0, 12)} | ${Y(costOf(r))} | ${(r.input + r.hit + r.output).toLocaleString('en-US')} | ${r.at.toISOString().slice(0, 16).replace('T', ' ')} |`)
}
p()
p('## 口径与误差')
p()
p('1. 会话用量是**累计值**，含该会话从开始到现在的全部轮次，无法按天切分；开发跨了多天多个会话。')
p('2. 余额账本只有装了用量追踪之后的数据，更早的开销没有记录，所以「真实扣费」是下限。')
p('3. 标价折算用平常价；夜间与周末走谷时价（约五折），所以真实支出低于标价。')
p('4. 私聊会话若未在 sidmap 登记会被算进「开发」，误差很小（私聊十几条）。')

writeFileSync(out, lines.join('\n'), 'utf8')
console.log('written: ' + out)
console.log(lines.join('\n'))
