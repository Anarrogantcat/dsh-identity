/**
 * 会累（web 侧验收）：连说 20 句后 tone 从 full 掉到 terse / low，且提示词真的变了。
 *
 * 这里验收两件事：
 *   1. 20 句之内 tone 一定经过 terse，最后落到 low（不是永远满格）
 *   2. workMode 打开时只压「干活力度」，不压「说话方式」——
 *      以前整个 tone 文案被替换成「精力只当状态记着」，等于把「会累」从聊天里关掉了
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-tired-'))
delete process.env.QQBOT_REFINE_HOME

const url = (p) => new URL(p, import.meta.url).href
const { ensureStore, loadConfig } = await import(url('../lib/config.js'))
const { ensureDirs } = await import(url('../lib/store.js'))
const W = await import(url('../lib/webgrowth.js'))
const P = await import(url('../lib/pace.js'))
ensureStore()
ensureDirs()

const ok = []
const T = (n, p, d) => ok.push([n, !!p, d])
const cfg = loadConfig()
const handlers = {}
W.installSessionGrowth({ on(ev, fn) { handlers[ev] = fn } }, { getConfig: () => cfg, logger: console, getLlm: () => null })

const sid = 'session-tired-0001'
const fire = (text, seq) => handlers['session/event']({ header: { id: sid } }, {
  type: 'assistant/message',
  seq,
  data: { message: { role: 'assistant', content: [{ type: 'text', text }] } },
})

// 一、连说 20 句：记下每一句之后的 tone
const tones = []
const energies = []
for (let i = 1; i <= 20; i++) {
  fire('这一句用来验精力', i)
  const s = P.snapshot()
  tones.push(s.tone)
  energies.push(s.energy)
}
T('第一句还是满状态', tones[0] === 'full', tones[0])
T('20 句之内出现过 terse', tones.includes('terse'), tones)
T('20 句后落到 low', tones[20 - 1] === 'low', tones)
T('精力单调下降', energies.every((e, i) => i === 0 || e <= energies[i - 1]), energies)
T('不是一直满格', tones.filter((t) => t === 'full').length < 20, tones)

// 二、workMode：话照短，活照干
{
  const full = P.toneHint('full', { workMode: true })
  const terse = P.toneHint('terse', { workMode: true })
  const low = P.toneHint('low', { workMode: true })
  T('三档文案互不相同', new Set([full, terse, low]).size === 3, [full, terse, low])
  T('terse 提醒话说短', /短/.test(terse), terse)
  T('low 也提醒话说短', /短/.test(low), low)
  T('workMode 不再把活压掉', !/别主动找事|工具能不用就不用/.test(terse + low), [terse, low])
  T('workMode 明说活照干', /活照干/.test(low) && /活照干/.test(terse), [terse, low])
}

// 三、非 workMode 的老文案还在（群里的语气不能被顺手改掉）
{
  T('默认 low 仍劝别找事', /别主动找事/.test(P.toneHint('low')), P.toneHint('low'))
  T('默认 terse 仍劝少绕弯', /少绕弯/.test(P.toneHint('terse')), P.toneHint('terse'))
  T('默认 full 是正常说', /正常说/.test(P.toneHint('full')), P.toneHint('full'))
}

console.log('=== 会累（web 20 句）测试 ===')
let fail = 0
for (const [n, p, d] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d))); if (!p) fail++ }
console.log(fail ? `失败 ${fail}` : '全部通过')
try { rmSync(process.env.DSH_HOME, { recursive: true, force: true }) } catch { /* ignore */ }
process.exitCode = fail ? 1 : 0
