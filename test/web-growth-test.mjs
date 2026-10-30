/**
 * web 会话成长：用户消息要能落成记忆
 * （真实事故：user/message 的 data 是消息本身，不是 data.message，导致 web 记忆一直是空的）
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOME = mkdtempSync(join(tmpdir(), 'dsh-webgrowth-'))
process.env.DSH_HOME = HOME
delete process.env.QQBOT_REFINE_HOME

const base = new URL('../', import.meta.url).href
const { ensureStore } = await import(base + 'lib/config.js')
const { ensureDirs, dirs } = await import(base + 'lib/store.js')
const { installSessionGrowth } = await import(base + 'lib/webgrowth.js')
const { listMemory } = await import(base + 'lib/memory.js')
const { readEvents } = await import(base + 'lib/events.js')
ensureStore(); ensureDirs()

const ok = []
const A = (n, p, d) => ok.push([n, !!p, d])

const handlers = []
const ctx = { on: (name, fn) => { if (name === 'session/event') handlers.push(fn) } }
const cfg = { memory: { enabled: true } }
A('装上了 session/event 钩子', installSessionGrowth(ctx, { getConfig: () => cfg, logger: { warn() {}, info() {} } }) === true && handlers.length === 1)
const fire = (session, event) => { for (const h of handlers) h(session, event) }

// 用户消息：data 本身就是 UserMessage（role + content 数组）
fire({ header: { id: 'web-abc' } }, {
  type: 'user/message',
  seq: 1,
  data: { role: 'user', content: [{ type: 'text', text: '我下周三要考试，别打扰我' }] },
})
const pk = 'web_web-abc'
const mem = listMemory(pk)
A('用户消息进了记忆', mem.length === 1 && mem[0].text.includes('考试'), mem)
A('出处记成 user', mem[0]?.origin === 'user', mem[0]?.origin)
A('事件也记了', readEvents(pk).some((e) => e.origin === 'inbound'), readEvents(pk).map((e) => e.origin))

// 助手消息：data.message 里
fire({ header: { id: 'web-abc' } }, {
  type: 'assistant/message',
  seq: 2,
  data: { message: { role: 'assistant', content: [{ type: 'text', text: '好，记下了' }] } },
})
A('助手消息进事件但不进记忆', readEvents(pk).some((e) => e.origin === 'bot') && listMemory(pk).length === 1, listMemory(pk).length)

// 字符串形式的 content 也要认
fire({ header: { id: 'web-abc' } }, { type: 'user/message', seq: 3, data: { role: 'user', content: '周末想去看海' } })
A('纯字符串内容也能记', listMemory(pk).some((x) => x.text.includes('看海')), listMemory(pk).map((x) => x.text))

// 隐私脱敏后入库（不存明文敏感串）
fire({ header: { id: 'web-abc' } }, { type: 'user/message', seq: 4, data: { role: 'user', content: '我的密钥是 sk-abcdef1234567890abcdef' } })
A('敏感串被脱敏', listMemory(pk).every((x) => !/sk-abcdef1234567890/.test(x.text)), listMemory(pk).map((x) => x.text))

// 宿主注入的伪用户消息不能记（真实事故：运行环境快照和技能目录提醒被当成
// "你说的话"存进记忆，300 字一条，以后还会被注回提示词）
{
  const before = listMemory(pk).length
  fire({ header: { id: 'web-abc' } }, {
    type: 'user/message',
    seq: 5,
    data: {
      role: 'user',
      content: [{ type: 'text', text: 'Current runtime context. This snapshot supersedes earlier runtime-context snapshots. Current working directory: "D:\\AI\\x". Current DSH file policy: danger-full-access.' }],
    },
  })
  A('运行环境快照不记记忆', listMemory(pk).length === before, listMemory(pk).length - before)
  A('运行环境快照不记事件', !readEvents(pk).some((e) => /runtime context/i.test(e.text ?? '')), readEvents(pk).length)

  fire({ header: { id: 'web-abc' } }, {
    type: 'user/message',
    seq: 6,
    data: { role: 'user', content: [{ type: 'text', text: '<system-reminder> The available skill catalog changed. This complete catalog replaces every earlier available-skills list in this session: office, office-docx </system-reminder>' }] },
  })
  A('技能目录提醒不记记忆', listMemory(pk).length === before, listMemory(pk).length - before)

  fire({ header: { id: 'web-abc' } }, {
    type: 'user/message',
    seq: 7,
    data: { role: 'user', content: [{ type: 'text', text: '帮我把面板字体调大 <system-reminder>catalog changed</system-reminder>' }] },
  })
  const last = listMemory(pk).at(-1)
  A('夹在真话后面的提醒被剥掉', /面板字体调大/.test(last?.text ?? '') && !/catalog changed|system-reminder/i.test(last?.text ?? ''), last?.text)
  A('剥完还留真话就不丢这条', listMemory(pk).length === before + 1, listMemory(pk).length - before)
}

// 助手消息里的 reasoning / tool-call 不是"她说的话"（真实事故：每条消息都把
// 英文内部草稿当发言记进事件，5627 条里 4664 条根本没有正文）
{
  const botsBefore = readEvents(pk).filter((e) => e.origin === 'bot').length
  fire({ header: { id: 'web-abc' } }, {
    type: 'assistant/message',
    seq: 8,
    data: {
      message: {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'Let me check the workspace for something related.' },
          { type: 'tool-call', id: 'c1', name: 'pwsh', arguments: '{}' },
        ],
      },
    },
  })
  A('只有草稿和工具调用的消息不算发言', readEvents(pk).filter((e) => e.origin === 'bot').length === botsBefore, readEvents(pk).filter((e) => e.origin === 'bot').length - botsBefore)

  fire({ header: { id: 'web-abc' } }, {
    type: 'assistant/message',
    seq: 9,
    data: {
      message: {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'The user wants the font bigger. I should answer in Chinese.' },
          { type: 'text', text: '行，本鱼这就调大。' },
        ],
      },
    },
  })
  const lastBot = readEvents(pk).filter((e) => e.origin === 'bot').at(-1)
  A('草稿+正文的消息只记正文', lastBot?.text === '行，本鱼这就调大。', lastBot?.text)

  const inBefore = readEvents(pk).filter((e) => e.origin === 'inbound').length
  fire({ header: { id: 'web-abc' } }, {
    type: 'user/message',
    seq: 10,
    data: { role: 'user', content: [{ type: 'image', source: { type: 'base64', data: 'xx' } }] },
  })
  A('纯图片消息不记文字', readEvents(pk).filter((e) => e.origin === 'inbound').length === inBefore, readEvents(pk).filter((e) => e.origin === 'inbound').length - inBefore)
}

// 审计里能看到 inbound（以前全是 bot）
{
  const ap = join(dirs.logs, 'audit.jsonl')
  const txt = existsSync(ap) ? readFileSync(ap, 'utf8') : ''
  A('审计里有 inbound 记录', /"origin":"inbound"/.test(txt), txt.slice(-160))
}

console.log('=== web 会话成长测试 ===')
let fail = 0
for (const [n, p, d] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d))); if (!p) fail++ }
console.log(fail ? `失败 ${fail}` : '全部通过')
try { rmSync(HOME, { recursive: true, force: true }) } catch { /* ignore */ }
process.exitCode = fail ? 1 : 0
