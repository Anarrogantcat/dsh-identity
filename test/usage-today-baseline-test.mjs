/**
 * 今日用量的基线：会话轮换/压缩后 sid 变了，累计值还是原来那份。
 * 真实事故：sid 在 sidmap 里 → 基线记 0 → 把整段历史（5037 万 tokens）算进"今天"，
 * 群预算显示超 62 倍，面板上"今日 32.1M / 5.20 元"全是假的。
 */
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOME = mkdtempSync(join(tmpdir(), 'dsh-usage-baseline-'))
process.env.DSH_HOME = HOME
delete process.env.QQBOT_REFINE_HOME

const base = new URL('../', import.meta.url).href
const { ensureStore } = await import(base + 'lib/config.js')
const { ensureDirs, dirs } = await import(base + 'lib/store.js')
const { todayDelta } = await import(base + 'lib/usage.js')
ensureStore(); ensureDirs()

const ok = []
const A = (n, p, d) => ok.push([n, !!p, d])

const SID = 'aaaa1111-bbbb-2222-cccc-333344445555-rmvtpw51n-rmvurbkq2'
// 模拟"轮换过的会话"：sid 被写进 sidmap
writeFileSync(join(dirs.root, 'sidmap.json'), JSON.stringify({ 'group:123456': SID }), 'utf8')

const big = { uncachedInputTokens: 2363018, outputTokens: 22803, cacheReadTokens: 47980672, cacheWriteTokens: 0 }

const d1 = todayDelta(SID, big)
A('轮换过的会话首次出现：今日增量 0（不把历史算今天）', d1.uncachedInputTokens === 0 && d1.cacheReadTokens === 0, d1)

const d2 = todayDelta(SID, { ...big, uncachedInputTokens: big.uncachedInputTokens + 700, outputTokens: big.outputTokens + 40 })
A('之后只算真正新增的部分', d2.uncachedInputTokens === 700 && d2.outputTokens === 40, d2)

// 新会话首次出现也记 0：口径统一，不搞特例（第一轮用量下轮会补上）
const FRESH = 'ffff0000-bbbb-2222-cccc-333344445555'
const fresh = { uncachedInputTokens: 800, outputTokens: 60, cacheReadTokens: 0, cacheWriteTokens: 0 }
const d3 = todayDelta(FRESH, fresh)
A('新会话首次出现同样是 0（口径一致）', d3.uncachedInputTokens === 0 && d3.outputTokens === 0, d3)
const d3b = todayDelta(FRESH, { ...fresh, uncachedInputTokens: 1500 })
A('新会话之后的增量照算', d3b.uncachedInputTokens === 700, d3b)

// 第二天：基线重钉一次，不能把昨天的累计再算一遍
const today = new Date()
const y = new Date(today.getTime() - 86400000)
const p2 = (n) => String(n).padStart(2, '0')
const ymd = `${y.getFullYear()}-${p2(y.getMonth() + 1)}-${p2(y.getDate())}`
mkdirSync(dirs.root, { recursive: true })
writeFileSync(join(dirs.root, 'usage.json'), JSON.stringify({
  date: ymd,
  peers: { [SID]: { uncachedInputTokens: 100, outputTokens: 10, cacheReadTokens: 1000, cacheWriteTokens: 0 } },
  latest: {},
}), 'utf8')
const d4 = todayDelta(SID, big)
A('跨天后从当天零点起算，不重复算历史', d4.uncachedInputTokens === 0 && d4.cacheReadTokens === 0, d4)

console.log('=== 今日用量基线测试 ===')
let fail = 0
for (const [n, p, d] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d))); if (!p) fail++ }
console.log(fail ? `失败 ${fail}` : '全部通过')
try { rmSync(HOME, { recursive: true, force: true }) } catch { /* ignore */ }
process.exitCode = fail ? 1 : 0
