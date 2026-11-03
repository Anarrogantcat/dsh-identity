// 共情弱信号：明说的情绪词之外，听得出来「他不对劲」的那些话
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const base = pathToFileURL(join(process.cwd(), 'lib')).href + '/'
const E = await import(base + 'empathy.js')

const ok = []
const eq = (n, got, want) => ok.push([n, JSON.stringify(got) === JSON.stringify(want), got, want])

// 弱信号：能认出来，且标了 weak
const w1 = E.detect('就这样吧')
ok.push(['「就这样吧」认成难过', w1 && w1.emotion === '难过', w1])
ok.push(['标了 weak', !!(w1 && w1.weak === true), w1])
eq('「算了吧」也是弱信号', E.detect('算了吧')?.weak, true)
eq('「无所谓」也是弱信号', E.detect('无所谓')?.weak, true)
eq('「不想说了」也是弱信号', E.detect('不想说了')?.weak, true)

// 游戏里的「随便打」不能算情绪
eq('「随便打滔博」不是情绪', E.detect('369选暮蝶中路封个烟随便打滔博'), null)
eq('「懒得动」不是弱信号', E.detect('但是我懒得动'), null)

// 强信号保持不变，且不带 weak
const s1 = E.detect('今天真的很难受')
ok.push(['「难受」还是强信号', s1 && s1.emotion === '难过' && !s1.weak && s1.intensity >= 0.35, s1])

// 门控口径：弱信号只认 bond>=2 的人；强信号照旧
const pass = (em, bond, directed) => !!em && (em.weak ? bond >= 2 : em.intensity >= 0.35) && (directed || bond >= 2)
ok.push(['弱信号 + 陌生人 → 不算', pass(E.detect('就这样吧'), 0, false) === false])
ok.push(['弱信号 + 熟人 → 算', pass(E.detect('就这样吧'), 2.1, false) === true])
ok.push(['弱信号 + 熟人 + 被叫到 → 算', pass(E.detect('就这样吧'), 3, true) === true])
ok.push(['强信号 + 被叫到 → 算', pass(E.detect('烦死了'), 0, true) === true])

// web 会话里「对她说的指令」不算她在共情
ok.push(['指令话不算自己状态', E.isSelfState('群友惹你生气了，可以把火撒在群友身上') === false])
ok.push(['「你可以毒一点」不算', E.isSelfState('你可以毒一点') === false])
ok.push(['「我今天有点累」算', E.isSelfState('我今天有点累') === true])
ok.push(['「我有点烦」算', E.isSelfState('我有点烦') === true])
let bad = 0
for (const [n, good, got, want] of ok) {
  if (!good) { bad++; console.log('FAIL ' + n + '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)) } else console.log('OK  ' + n)
}
console.log(bad ? ('失败 ' + bad) : '全部通过')
process.exit(bad ? 1 : 0)
