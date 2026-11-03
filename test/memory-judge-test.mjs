/**
 * 判断蒸馏：把一段对话压成结论再记，而不是把原话一条条堆进记忆。
 * 用假 llm，不联网。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-judge-'))
delete process.env.QQBOT_REFINE_HOME
const url = (p) => new URL(p, import.meta.url).href
const { ensureStore } = await import(url('../lib/config.js'))
const { ensureDirs } = await import(url('../lib/store.js'))
const J = await import(url('../lib/judge.js'))
const { listMemory } = await import(url('../lib/memory.js'))
ensureStore(); ensureDirs()

const ok = []
const T = (n, p, d) => ok.push([n, !!p, d])

const good = '[{"text":"主人很在意精力是不是真的生效，不只是有个百分比","category":"preference","importance":0.7,"emotion":0.3,"valence":0.1}]'
const parsed = J.parseJudgments(good)
T('正常 JSON 能解析', parsed.length === 1 && parsed[0].category === 'preference' && parsed[0].importance === 0.7, parsed)

const noisy = '好的，我整理一下：\n' + good + '\n就这些。'
T('散文里夹的 JSON 也能抠出来', J.parseJudgments(noisy).length === 1, J.parseJudgments(noisy))

T('坏 JSON 不炸', J.parseJudgments('{not json[').length === 0)
T('空串返回空', J.parseJudgments('').length === 0)
T('超长条目被丢', J.parseJudgments('[{"text":"' + '很'.repeat(80) + '","category":"fact"}]').length === 0)

// —— 先核实再断言：提示词里必须有这条纪律（linghun 的「最小可用三条」） ——
T('提示词要求先核实', /核实/.test(J.JUDGE_PROMPT), J.JUDGE_PROMPT.slice(0, 80))
T('提示词要求有依据才写', /依据/.test(J.JUDGE_PROMPT), '')
T('提示词区分推断与事实', /推断/.test(J.JUDGE_PROMPT), '')

// —— 缓冲与触发 ——
const pk = 'web_judge-test'
J.pushTalk(pk, 'user', '感觉精力没生效')
J.pushTalk(pk, 'user', '你的建议呢？')
T('攒了 2 条', J.buffered(pk).length === 2, J.buffered(pk).length)
T('条数不够不蒸馏', J.due(pk, { memory: {} }, Date.now()) === false)
J.pushTalk(pk, 'user', '能不能做到学习成长，形成人格')
J.pushTalk(pk, 'self', '我推第二种，但不是纯按轮次数')
J.pushTalk(pk, 'user', '我的目标是让你能学习成长')
J.pushTalk(pk, 'self', '这个目标我认')
T('攒够 6 条该蒸馏', J.due(pk, { memory: {} }, Date.now()) === true, J.pendingCount(pk))

// —— 用假 llm 蒸馏 ——
const cfg = { memory: { enabled: true, judge: true, judgeEvery: 6 }, integration: { llmProvider: 'p', llmModel: 'm' } }
const llm = {
  stream: async function* () {
    yield { type: 'text-delta', text: good }
    yield { type: 'finish', reason: 'stop' }
  },
}
const r = await J.distill(pk, { cfg, llm, logger: { warn() {} } })
const mem = listMemory(pk)
T('蒸馏成功写了 1 条判断', r.ok === true && r.n === 1 && mem.length === 1, { r, mem })
T('判断卡出处是 agent（不是原话）', mem[0]?.origin === 'agent' && mem[0]?.category === 'preference', mem[0])
T('判断卡重要度高', (mem[0]?.importance ?? 0) >= 0.7, mem[0]?.importance)
T('蒸馏后 pending 清零', J.pendingCount(pk) === 0, J.pendingCount(pk))
T('缓冲只留最近两条当上下文', J.buffered(pk).length === 2, J.buffered(pk).length)

// —— 近似重复不再写 ——
const llm2 = {
  stream: async function* () {
    yield { type: 'text-delta', text: '[{"text":"主人很在意精力是不是真的生效，不只是有个百分比","category":"preference","importance":0.7}]' }
  },
}
J.pushTalk(pk, 'user', '我还是觉得精力没生效')
J.pushTalk(pk, 'user', '你看看是不是参数问题')
const r2 = await J.distill(pk, { cfg, llm: llm2, logger: { warn() {} } })
T('近似重复的判断不重复记', r2.ok === true && r2.n === 0 && listMemory(pk).length === 1, { r2, n: listMemory(pk).length })

// —— 没有 llm 不炸 ——
const r3 = await J.distill(pk, { cfg, llm: null })
T('没有 llm 时静默返回', r3.ok === false && r3.error === 'no-llm', r3)

// —— 关掉开关就不触发 ——
J.pushTalk('web_off', 'user', '随便说点什么内容')
T('judge=false 时不蒸馏', J.due('web_off', { memory: { judge: false } }) === false)

console.log('=== 判断蒸馏测试 ===')
let fail = 0
for (const [n, p, d] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d))); if (!p) fail++ }
console.log(fail ? '失败 ' + fail : '全部通过')
try { rmSync(process.env.DSH_HOME, { recursive: true, force: true }) } catch {}
process.exit(fail ? 1 : 0)
