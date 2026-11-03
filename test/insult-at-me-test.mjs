// 「笨蛋一个」这类没名字没@的骂人话，刚说完话就该算冲她来的
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const base = pathToFileURL(join(process.cwd(), 'lib')).href + '/'
const { isBareInsultAtMe, isWarmFollow } = await import(base + 'qq-behavior.js')
const { KERNEL, kernelText } = await import(base + 'identity.js')

const ok = []
const T = (n, c, e) => ok.push([n, !!c, e])

// 短时间内的短骂人话
T('「笨蛋一个」刚说完话 → 冲她', isBareInsultAtMe('笨蛋一个', 30) === true)
T('「你真傻」也算', isBareInsultAtMe('你真傻', 20) === true)
T('时间太久 → 不算', isBareInsultAtMe('笨蛋一个', 600) === false)
T('不是骂人 → 不算', isBareInsultAtMe('今天网络好差', 10) === false)
T('长句里带笨 → 不算（防误认）', isBareInsultAtMe('这个笨蛋程序又卡了怎么办啊', 10) === false)
T('没说过话（0 秒基准不存在）→ 由调用方保证', isBareInsultAtMe('笨蛋', 9999) === false)

// 聊过之后隔一两分钟补一句，也算在跟她说
T('「多吃点，别饿着了」5 分钟内 → 接', isWarmFollow({ sameSender: true, rtAgeMs: 60_000, spokeAgeMs: 50_000, text: '多吃点，别饿着了' }) === true)
T('同一个人的话但隔了 10 分钟 → 不接', isWarmFollow({ sameSender: true, rtAgeMs: 600_000, spokeAgeMs: 590_000, text: '多吃点' }) === false)
T('不是同一个人 → 不接', isWarmFollow({ sameSender: false, rtAgeMs: 10_000, spokeAgeMs: 10_000, text: '多吃点' }) === false)
T('长作文不当作接话', isWarmFollow({ sameSender: true, rtAgeMs: 1000, spokeAgeMs: 1000, text: '这'.repeat(60) }) === false)
T('@ 别人的消息不算', isWarmFollow({ sameSender: true, rtAgeMs: 1000, spokeAgeMs: 1000, text: '@123456 你说呢' }) === false)

// 人格里得有「不自我贬低 / 不奉承」这两条
const txt = kernelText(KERNEL) + JSON.stringify(KERNEL)
T('人格含「不自我贬低」', /自我贬低/.test(txt), txt.slice(0, 80))
T('人格含「自作多情」禁令', /自作多情/.test(txt))
T('人格含「别用…奉承腔」', /奉承腔/.test(txt))
T('人格允许被惹到嘴毒回去', /嘴毒一句顶回去/.test(txt))
T('嘴毒有边界（不脏话/人身攻击）', /不骂脏话|人身攻击/.test(txt))

let bad = 0
for (const [n, good, e] of ok) { if (good) console.log('OK  ' + n); else { bad++; console.log('FAIL ' + n + '  ' + String(JSON.stringify(e)).slice(0, 160)) } }
console.log(bad ? ('失败 ' + bad) : '全部通过')
process.exit(bad ? 1 : 0)
