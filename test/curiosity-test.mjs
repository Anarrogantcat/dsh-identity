/**
 * 好奇：找「没人接住的问句」。
 * 以前判「后面有没有任何 bot 发言」，群里 bot 那么活跃，几乎每个问句都被算成接过，
 * 结果 51 个问句一个都没被挑出来，好奇永远是空的。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-curio-'))
delete process.env.QQBOT_REFINE_HOME
const url = (p) => new URL(p, import.meta.url).href
const { ensureStore } = await import(url('../lib/config.js'))
const { ensureDirs, peerKey } = await import(url('../lib/store.js'))
const E = await import(url('../lib/events.js'))
const { curiosities } = await import(url('../lib/autonomy.js'))
const { dayStr } = await import(url('../lib/diary.js'))
ensureStore(); ensureDirs()

const ok = []
const T = (n, p, d) => ok.push([n, !!p, d])
const PK = peerKey('group', 'G-CURIO')
const date = dayStr()
const at = (m) => `${date}T${String(10 + Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00+08:00`

// 一：问句后面连着三条群聊，没人回 → 该被挑出来
E.appendEvent(PK, { kind: 'talk', origin: 'inbound', who: '小明', text: '这个报错怎么解决', at: at(0) })
E.appendEvent(PK, { kind: 'talk', origin: 'inbound', who: '小红', text: '有人知道吗', at: at(1) })
E.appendEvent(PK, { kind: 'talk', origin: 'inbound', who: '小刚', text: '我猜是缓存', at: at(2) })
E.appendEvent(PK, { kind: 'talk', origin: 'inbound', who: '小明', text: '你们说呢', at: at(3) })

// 二：问句后面紧接着 bot 回答 → 不算没接住
E.appendEvent(PK, { kind: 'talk', origin: 'inbound', who: '小美', text: '明天几点开', at: at(10) })
E.appendEvent(PK, { kind: 'talk', origin: 'bot', who: '我', text: '十点', at: at(11) })

const c = curiosities(PK, { limit: 3 })
T('没被接住的问句能被挑出来', c.some((x) => String(x.text).includes('报错')), c)
T('被接住的问句不再算好奇', !c.some((x) => String(x.text).includes('几点开')), c)
T('最多返回 limit 条', c.length <= 3, c.length)

console.log('=== 好奇提取测试 ===')
let fail = 0
for (const [n, p, d] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d))); if (!p) fail++ }
console.log(fail ? '失败 ' + fail : '全部通过')
try { rmSync(process.env.DSH_HOME, { recursive: true, force: true }) } catch {}
process.exit(fail ? 1 : 0)
