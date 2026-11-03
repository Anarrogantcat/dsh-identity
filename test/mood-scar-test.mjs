/**
 * 会痛：负面情绪的半衰期比正面长。
 * 被伤着不会半天就翻篇——这是「像人」里最难写、也最容易被忽略的一段。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-scar-'))
delete process.env.QQBOT_REFINE_HOME
const url = (p) => new URL(p, import.meta.url).href
const { ensureStore } = await import(url('../lib/config.js'))
const { ensureDirs } = await import(url('../lib/store.js'))
const M = await import(url('../lib/moodv2.js'))
ensureStore(); ensureDirs()

const ok = []
const T = (n, p, d) => ok.push([n, !!p, d])
const HOUR = 3600000

// 12 小时前：高兴和生气都冲到 0.9
const at = new Date(Date.now() - 12 * HOUR).toISOString()
const state = {
  version: 1,
  seven: Object.fromEntries(M.SEVEN.map((k) => [k, 0.3])),
  needs: Object.fromEntries(M.NEEDS.map((k) => [k, 0.3])),
  at,
}
state.seven.joy = 0.9
state.seven.anger = 0.9

const now = Date.now()
const decayed = M.decayOf(state, now)
const joyLeft = decayed.seven.joy - 0.3
const angerLeft = decayed.seven.anger - 0.3

T('12 小时后高兴减半', Math.abs(joyLeft - 0.3) < 0.02, joyLeft)
T('12 小时后火气还在（没减半）', angerLeft > 0.4, angerLeft)
T('同样的时间，负面留得更久', angerLeft > joyLeft + 0.1, { joyLeft, angerLeft })

// 24 小时后火气减半（新口径：负面半衰期 24h —— 睡一觉该消一半）
const at24 = new Date(Date.now() - 24 * HOUR).toISOString()
const d24 = M.decayOf({ ...state, at: at24 }, now)
const anger24 = d24.seven.anger - 0.3
T('24 小时后火气减半', Math.abs(anger24 - 0.3) < 0.04, anger24)

// 同样的 24 小时，高兴淡得更快
const joy24 = d24.seven.joy - 0.3
T('同样 24 小时，高兴淡得更快', joy24 < anger24 - 0.1, { anger24, joy24 })

console.log('=== 会痛（负面余温）测试 ===')
let fail = 0
for (const [n, p, d] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d))); if (!p) fail++ }
console.log(fail ? '失败 ' + fail : '全部通过')
try { rmSync(process.env.DSH_HOME, { recursive: true, force: true }) } catch {}
process.exit(fail ? 1 : 0)
