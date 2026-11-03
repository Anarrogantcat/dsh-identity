// 回归：被 @ 的时候，社交判定不能把它否掉（以前 @ 会被当「没信号」吞掉）
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const base = pathToFileURL(join(process.cwd(), 'lib')).href + '/'
const { createGate } = await import(base + 'channel-qq/gate.js')
const { loadConfig } = await import(base + 'config.js')

const cfg = loadConfig()
const gate = createGate({
  getConfig: () => cfg,
  saveConfig: () => {},
  diagRef: { counts: {} },
  logger: { warn() {}, info() {}, error() {} },
  getLlm: () => null,
  getClient: () => null,
})

let seq = 0
function ev({ content, mention }) {
  return {
    __onebot: true,
    scope: 'group',
    peer: '830148935',
    sender: '2849016469',
    senderName: '测试人',
    content,
    mentions: mention ? [{ bot: true, id: '3546631373' }] : [],
    mentionsOther: [],
    images: [],
    attachments: [],
    msgId: 'gate-mention-' + (++seq),
    role: 'member',
    recent: [],
  }
}

const ok = []
const check = (n, good, extra) => ok.push([n, good, extra])

// 1) 只有 @、文字没信息量：不能吞
const a = await gate.onInbound({}, ev({ content: '[图片]', mention: true }))
check('@ + 纯图 不拦', a === false, a)

// 2) 同样内容、没 @：该被当没信号挡掉
const b = await gate.onInbound({}, ev({ content: '[图片]', mention: false }))
check('没 @ 的纯图 拦掉', b === true, b)

// 3) @ + 一句没营养的话
const c = await gate.onInbound({}, ev({ content: '大肥鱼这是不是你', mention: true }))
check('@ + 短句 不拦', c === false, c)

let bad = 0
for (const [n, good, extra] of ok) {
  if (good) console.log('OK  ' + n)
  else { bad++; console.log('FAIL ' + n + ' -> ' + JSON.stringify(extra)) }
}
console.log(bad ? ('失败 ' + bad) : '全部通过')
process.exit(bad ? 1 : 0)
