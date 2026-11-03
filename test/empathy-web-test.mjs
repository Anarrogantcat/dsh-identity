/**
 * 共情（web 侧验收）：说难受 → 下一轮有共情提示；说「别安慰我」→ 上一条标 negative，且不再硬塞提示。
 *
 * 以前只验过 QQ 通道。web 会话的坑：
 *   · 记录写进 web_<sid> 桶，但提示词那边取的是通道 peer → 私聊再难受也没提示
 *   · 提示只看「最近一条」，不看 outcome → 对方说了别安慰，下一轮还在安慰
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-emp-'))
delete process.env.QQBOT_REFINE_HOME

const url = (p) => new URL(p, import.meta.url).href
const { ensureStore, loadConfig } = await import(url('../lib/config.js'))
const { ensureDirs } = await import(url('../lib/store.js'))
const W = await import(url('../lib/webgrowth.js'))
const E = await import(url('../lib/empathy.js'))
ensureStore()
ensureDirs()

const ok = []
const T = (n, p, d) => ok.push([n, !!p, d])
const cfg = loadConfig()
const handlers = {}
W.installSessionGrowth({ on(ev, fn) { handlers[ev] = fn } }, { getConfig: () => cfg, logger: console, getLlm: () => null })

const sid = 'session-empathy-0001'
const pk = 'web_' + sid
let seq = 0
const say = (text) => handlers['session/event']({ header: { id: sid } }, {
  type: 'user/message',
  seq: ++seq,
  data: { role: 'user', content: [{ type: 'text', text }] },
})

// 一、说难受 → 记一条「难过」，提示词能拿到
say('今天有点难受，什么都不想干')
{
  const hit = E.recent(5).find((x) => x.peer === pk)
  T('web 会话记到情绪', hit?.emotion === '难过', hit)
  T('写进 web_<sid> 桶', !!hit, hit?.peer)
  const p = E.promptFor(pk)
  T('下一轮有共情提示', !!p && /先/.test(p.guide), p?.guide)
}

// 二、说「别安慰我」→ 上一条标 negative，提示不再硬塞
say('别安慰我，我不想听这些')
{
  const hit = E.recent(5).find((x) => x.peer === pk)
  T('被拒的那条标 negative', hit?.outcome === 'negative', hit)
  T('被拒之后不再提共情', E.promptFor(pk) === null, E.promptFor(pk))
}

// 三、隔了一条之后又说烦 → 重新给提示（不是永久关掉）
say('烦死了，这破玩意儿又崩了')
{
  const p = E.promptFor(pk)
  T('新的情绪重新有提示', !!p && /气/.test(p.guide), p?.guide)
}

// 四、超时的不再提
{
  const old = E.recent(5).find((x) => x.peer === 'web_other')
  T('别的会话不串', !old, old)
}

console.log('=== 共情（web）测试 ===')
let fail = 0
for (const [n, p, d] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d))); if (!p) fail++ }
console.log(fail ? `失败 ${fail}` : '全部通过')
try { rmSync(process.env.DSH_HOME, { recursive: true, force: true }) } catch { /* ignore */ }
process.exitCode = fail ? 1 : 0
