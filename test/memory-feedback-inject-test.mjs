/**
 * 教训必须进上下文：刚被纠正过的 feedback，不能被「断崖」砍掉。
 * 「被提醒过的事下次记得住」靠的是它真的被读到，不是存在文件里。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-fbinj-'))
delete process.env.QQBOT_REFINE_HOME
const url = (p) => new URL(p, import.meta.url).href
const { ensureStore } = await import(url('../lib/config.js'))
const { ensureDirs, peerKey } = await import(url('../lib/store.js'))
const Mem = await import(url('../lib/memory.js'))
ensureStore(); ensureDirs()

const ok = []
const T = (n, p, d) => ok.push([n, !!p, d])
const HOUR = 3600000
const at = (h) => new Date(Date.now() - h * HOUR).toISOString()
const cfg = { memory: { injectTop: 5, injectChars: 500, dynamicThreshold: true, injectFloor: 0.2, injectGapRatio: 1.35 } }

// 教训本身分数很低（importance 0.05），正常排序根本进不了前 5。
// 只有「24 小时内被纠正过」这条硬规则能把它捞进来。
const PK = peerKey('group', 'G-FB')
Mem.addMemory(PK, { text: '被提醒：回答前先看上下文，别硬接', category: 'feedback', importance: 0.05, at: at(1), origin: 'user' })
for (let i = 0; i < 6; i++) Mem.addMemory(PK, { text: '重要的事第' + i + '条', category: 'event', importance: 0.95, at: at(0.5), origin: 'user' })

const card = Mem.memoryCard(PK, cfg)
T('分数很低也要把刚纠正的教训带进来', card.includes('看上下文'), card)
T('教训标了日期', /\[20\d\d-\d\d-\d\d\]/.test(card), card)

// 同样是低分旧账，但超过 24 小时 → 不强插
const PK2 = peerKey('group', 'G-FB2')
Mem.addMemory(PK2, { text: '被提醒：一个月前的老毛病', category: 'feedback', importance: 0.05, at: at(30 * 24), origin: 'user' })
for (let i = 0; i < 6; i++) Mem.addMemory(PK2, { text: '重要的事第' + i + '条', category: 'event', importance: 0.95, at: at(0.5), origin: 'user' })
const card2 = Mem.memoryCard(PK2, cfg)
T('超过 24 小时的旧账不强插', !card2.includes('老毛病'), card2)

console.log('=== 教训注入测试 ===')
let fail = 0
for (const [n, p, d] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d))); if (!p) fail++ }
console.log(fail ? '失败 ' + fail : '全部通过')
try { rmSync(process.env.DSH_HOME, { recursive: true, force: true }) } catch {}
process.exit(fail ? 1 : 0)
