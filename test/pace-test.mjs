/**
 * 精力语义：同一段对话里越说越费、恢复要时间、低精力只改说话方式不消失。
 * Owner 不受限；主动开口比被动回复更容易被拦。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-pace-'))
delete process.env.QQBOT_REFINE_HOME
const url = (p) => new URL(p, import.meta.url).href
const { ensureStore } = await import(url('../lib/config.js'))
const { ensureDirs, dirs, writeJson } = await import(url('../lib/store.js'))
const P = await import(url('../lib/pace.js'))
ensureStore(); ensureDirs()

const ok = []
const T = (n, p, d) => ok.push([n, !!p, d])
const near = (a, b, eps = 0.006) => Math.abs(Number(a) - Number(b)) <= eps

// 固定起点，不依赖真实时钟
const t0 = 1793450000000
const MIN = 60000
writeJson(join(dirs.root, 'pace.json'), { energy: 0.85, at: new Date(t0).toISOString(), stamps: [], streak: 0 })

// —— 初始与递增消耗 ——
const s0 = P.snapshot(t0)
T('初始精力 0.85', near(s0.energy, 0.85), s0)

P.noteReply(t0)
const s1 = P.snapshot(t0)
T('第一句扣基础 3%', near(s1.energy, 0.82), s1)

P.noteReply(t0 + 10000)
const s2 = P.snapshot(t0 + 10000)
T('第二句扣得更多（5.5%）', near(s2.energy, 0.765), s2)

P.noteReply(t0 + 20000)
const s3 = P.snapshot(t0 + 20000)
T('第三句继续递增（8%）', near(s3.energy, 0.685), s3)

// —— 恢复要时间：每分钟 2% ——
const r1 = P.snapshot(t0 + 20000 + 2 * MIN)
T('两分钟恢复 4%', near(r1.energy, 0.725), r1)

// —— 隔 5 分钟算新的一段：消耗回到起点 ——
P.noteReply(t0 + 20000 + 6 * MIN)
const s4 = P.snapshot(t0 + 20000 + 6 * MIN)
T('隔 6 分钟后按基础价扣（不继承 streak）', near(s4.energy, 0.775), s4)

// —— tone 分档 ——
T('满状态 tone=full', P.toneOf(0.8) === 'full', P.toneOf(0.8))
T('犯懒 tone=terse', P.toneOf(0.4) === 'terse', P.toneOf(0.4))
T('没劲 tone=low', P.toneOf(0.2) === 'low', P.toneOf(0.2))
T('toneHint 给的是具体指令', P.toneHint('low').includes('一句'), P.toneHint('low'))

// —— 低精力：被动回复照常，主动开口被拦 ——
let lowAt = t0 + 20000 + 6 * MIN
for (let i = 0; i < 5; i++) { lowAt += 1000; P.noteReply(lowAt) }
const lowNow = lowAt + 1000
const passive = P.allowReply({ role: 'member', now: lowNow })
const active = P.allowReply({ role: 'member', now: lowNow, proactive: true })
T('低精力时被动回复不倒（不消失）', passive.ok === true, passive)
T('低精力时主动开口被拦', active.ok === false, active)
T('拦的理由是精力低', /精力低/.test(String(active.reason)), active.reason)

// —— 低精力说的话记成「硬撑」，给复盘用 ——
const tiredSnap = P.snapshot(lowNow)
T('低精力说话记成「硬撑」', Number(tiredSnap.tired) >= 1, tiredSnap)

// —— Owner 不受限 ——
const owner = P.allowReply({ role: 'owner', now: lowNow })
T('Owner 永远放行', owner.ok === true, owner)

// —— 静置后恢复，不会永久瘫掉 ——
const burstAt = lowNow + 60 * MIN
const fresh = P.snapshot(burstAt)
T('静置一小时能回满', near(fresh.energy, 1), fresh)
const early = P.allowReply({ role: 'member', now: burstAt })
T('恢复后允许回复', early.ok === true, early)

console.log('=== 精力语义测试 ===')
let fail = 0
for (const [n, p, d] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d))); if (!p) fail++ }
console.log(fail ? '失败 ' + fail : '全部通过')
try { rmSync(process.env.DSH_HOME, { recursive: true, force: true }) } catch {}
process.exit(fail ? 1 : 0)
