/**
 * P1 身份核心（新模型）：一个基础人设 + 自动场景 + traits 生长
 * 旧的 preset/风格库已删除，不再测试迁移。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-p1-'))
delete process.env.QQBOT_REFINE_HOME
const url = (p) => new URL(p, import.meta.url).href
const I = await import(url('../lib/identity.js'))
const ok = []
const A = (n, p, d) => ok.push([n, !!p, d])

A('内核有名字/物种', I.KERNEL.name === '大肥鱼' && I.KERNEL.species === '鲸鱼娘')
A('内核有价值观与底线', I.kernelText().includes('说实话') && I.kernelText().includes('不泄露隐私'))
A('群聊场景含 QQ 群', I.composeIdentity({ scope: 'group' }).text.includes('QQ 群里'))
A('DSH 场景不含 QQ 群', !I.composeIdentity({ scope: 'web' }).text.includes('QQ 群里'))
A('基础人设会注入', I.composeIdentity({ scope: 'group', baseText: '你是我的鲸鱼娘，说话慢慢来。' }).text.includes('说话慢慢来'))
A('不超过预算', I.composeIdentity({ scope: 'group', baseText: 'x'.repeat(2000) }).used <= 900)
A('没有旧风格注入', !I.composeIdentity({ scope: 'group' }).text.includes('才、才不是'))
A('摘要结构', I.kernelSummary().chars <= 900)
A('旧风格 API 已删除', typeof I.listStyles === 'undefined' && typeof I.resolveStyle === 'undefined')

console.log('=== P1 身份核心测试 ===')
let fail = 0
for (const [n, p, d] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d))); if (!p) fail++ }
console.log(fail ? '失败 ' + fail : '全部通过')
try { rmSync(process.env.DSH_HOME, { recursive: true, force: true }) } catch {}
process.exit(fail ? 1 : 0)
