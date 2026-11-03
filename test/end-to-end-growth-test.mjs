/**
 * 端到端：web 对话 → 判断蒸馏 → 进记忆 → 注入提示词。
 * 证明「记判断而非原话」不是只写进文件，而是真的会回到她脑子里。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-e2e-'))
delete process.env.QQBOT_REFINE_HOME
const url = (p) => new URL(p, import.meta.url).href
const { ensureStore } = await import(url('../lib/config.js'))
const { ensureDirs } = await import(url('../lib/store.js'))
const { listMemory } = await import(url('../lib/memory.js'))
const { installSessionGrowth } = await import(url('../lib/webgrowth.js'))
const I = await import(url('../index.js'))
ensureStore(); ensureDirs()

const ok = []
const T = (n, p, d) => ok.push([n, !!p, d])
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const good = '[{"text":"主人要的是会成长的东西，不是功能清单","category":"preference","importance":0.72,"emotion":0.4,"valence":0.3}]'
const llm = {
  stream: async function* () {
    yield { type: 'text-delta', text: good }
    yield { type: 'finish', reason: 'stop' }
  },
}
const cfg = { memory: { enabled: true, judge: true, judgeEvery: 4 }, integration: { llmProvider: 'p', llmModel: 'm' } }
const handlers = []
const ctx = { on: (n, f) => { if (n === 'session/event') handlers.push(f) } }
installSessionGrowth(ctx, { getConfig: () => cfg, logger: { warn() {} }, getLlm: () => llm })

const sid = 'e2e-growth-001'
const fire = (text, seq) => {
  for (const h of handlers) h({ header: { id: sid } }, { type: 'user/message', seq, data: { role: 'user', content: [{ type: 'text', text }] } })
}
fire('感觉精力没生效', 1)
fire('我要的不是数字，是有感觉', 2)
fire('能不能做到学习成长形成人格', 3)
fire('不要有太多的限制', 4)
fire('别限制你的成长', 5)
await sleep(400) // distill 是异步的

const pk = 'web_' + sid
const mem = listMemory(pk)
const judged = mem.filter((x) => x.origin === 'agent')
T('对话后写进了判断卡', judged.length >= 1, mem.map((x) => [x.origin, x.category, x.text]))
T('判断卡分类是偏好', judged.some((x) => x.category === 'preference'), judged)
T('判断卡不是原话', judged.every((x) => !/感觉精力没生效|不要有太多的限制/.test(x.text)), judged.map((x) => x.text))

const injected = I.memorySectionText({ session: { id: sid } })
T('判断卡会注入提示词', /会成长的东西|功能清单/.test(injected), injected)
T('注入时标出是本鱼记的', injected.includes('[本鱼记的]'), injected.slice(0, 200))

console.log('=== 端到端成长链测试 ===')
let fail = 0
for (const [n, p, d] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d))); if (!p) fail++ }
console.log(fail ? '失败 ' + fail : '全部通过')
try { rmSync(process.env.DSH_HOME, { recursive: true, force: true }) } catch {}
process.exit(fail ? 1 : 0)
