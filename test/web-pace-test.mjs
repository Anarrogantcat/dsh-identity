/**
 * web 会话也要会累。
 *
 * 以前 pace.noteReply() 只在 QQ 的发送路径里调，web 会话永远满精力——
 * 「会累」只在群里成立，私下聊再多也不困。这里守住：她每说一句，精力就掉。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-webpace-'))
delete process.env.QQBOT_REFINE_HOME

const url = (p) => new URL(p, import.meta.url).href
const { ensureStore, loadConfig } = await import(url('../lib/config.js'))
const { ensureDirs } = await import(url('../lib/store.js'))
const W = await import(url('../lib/webgrowth.js'))
const P = await import(url('../lib/pace.js'))
ensureStore(); ensureDirs()

const ok = []
const T = (n, p, d) => ok.push([n, !!p, d])
const cfg = loadConfig()
const handlers = {}
W.installSessionGrowth({ on(ev, fn) { handlers[ev] = fn } }, { getConfig: () => cfg, logger: console, getLlm: () => null })

const before = P.snapshot().energy
const fire = (type, text, seq) => handlers['session/event']({ header: { id: 'session-pace-1' } }, {
  type,
  seq,
  data: type === 'assistant/message'
    ? { message: { role: 'assistant', content: [{ type: 'text', text }] } }
    : { role: 'user', content: [{ type: 'text', text }] },
})

fire('assistant/message', '嗯，我在呢', 1)
const after1 = P.snapshot().energy
T('她说一句就掉精力', after1 < before, [before, after1])

fire('assistant/message', '接着陪你聊', 2)
const after2 = P.snapshot().energy
T('越说越费（第二句掉得更多或至少继续掉）', after2 < after1, [after1, after2])

const beforeUser = P.snapshot().energy
fire('user/message', '我先说一句', 3)
const afterUser = P.snapshot().energy
T('用户说话不扣她精力', afterUser >= beforeUser, [beforeUser, afterUser])

console.log('=== web 精力测试 ===')
let fail = 0
for (const [n, p, d] of ok) {
  console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d)))
  if (!p) fail++
}
console.log(fail ? `失败 ${fail}` : '全部通过')
try { rmSync(process.env.DSH_HOME, { recursive: true, force: true }) } catch { /* ignore */ }
process.exit(fail ? 1 : 0)
