/**
 * P26 从对话里学习：反馈→记忆+自我候选；复盘→记忆
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-p26-'))
delete process.env.QQBOT_REFINE_HOME
const url = (p) => new URL(p, import.meta.url).href
const { feedbackTraitOf } = await import(url('../lib/feedback.js'))
const { ensureStore } = await import(url('../lib/config.js'))
const { ensureDirs } = await import(url('../lib/store.js'))
const traits = await import(url('../lib/traits.js'))
ensureStore(); ensureDirs()
const ok = []
const T = (n, p, d) => ok.push([n, !!p, d])
T('纠正语气 → 候选', feedbackTraitOf('你别这么凶') === '别对群友太凶、太冲')
T('嫌短 → 候选', feedbackTraitOf('说太短了，多说点') === '可以多说一点，别总一两句')
T('夸 → 候选', feedbackTraitOf('好可爱') === '被夸可爱会开心，但别飘')
T('普通闲聊不产生候选', feedbackTraitOf('今天吃了没') === '')
const r1 = traits.observe('别对群友太凶', { ref: 'fb:1', kind: 'feedback' })
const r2 = traits.observe('别对群友太凶', { ref: 'fb:2', kind: 'feedback' })
T('反馈能进 traits 观察', r1.ok && r2.ok && r2.hits >= 2, [r1, r2])
console.log('=== P26 对话学习测试 ===')
let fail = 0
for (const [n, p, d] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d))); if (!p) fail++ }
console.log(fail ? '失败 ' + fail : '全部通过')
try { rmSync(process.env.DSH_HOME, { recursive: true, force: true }) } catch {}
process.exit(fail ? 1 : 0)
