import { decideInbound } from '../lib/decide.js'

let fail = 0
const A = (name, cond, extra = '') => { if (cond) console.log('OK  ' + name); else { fail++; console.log('FAIL ' + name, extra) } }

A('硬规则 @别人 → 不接', decideInbound({ hard: 'otherMention' }).reply === false)
A('硬规则 纯反应 → 不接', decideInbound({ hard: 'reaction' }).reply === false)
A('硬规则 冷却 → 不接', decideInbound({ hard: 'cooldown' }).reply === false)
A('被提到 → 接', decideInbound({ mentionDefault: true }).source === 'mention-default')
A('叫名字 → 接', decideInbound({ nameHit: true }).source === 'name')
A('判断器 true → 接', decideInbound({ modelDirected: true }).source === 'model')
A('没有信号 → 不接', decideInbound({}).reply === false)
A('主动 → 接', decideInbound({ proactive: true, reason: 'x' }).source === 'proactive')

console.log('失败 ' + fail)
process.exit(fail ? 1 : 0)
