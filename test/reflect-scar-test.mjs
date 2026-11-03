/**
 * 会痛，第二步：同一个坑又踩了，复盘得自己说出来。
 * 顺带钉住 category='feedback' 真的存得进去（以前会被归一成 event）。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-scar2-'))
delete process.env.QQBOT_REFINE_HOME
const url = (p) => new URL(p, import.meta.url).href
const { ensureStore } = await import(url('../lib/config.js'))
const { ensureDirs, peerKey } = await import(url('../lib/store.js'))
const Mem = await import(url('../lib/memory.js'))
const R = await import(url('../lib/reflection.js'))
const D = await import(url('../lib/diary.js'))
ensureStore(); ensureDirs()

const ok = []
const T = (n, p, d) => ok.push([n, !!p, d])
const PK = peerKey('group', 'G-SCAR')

// feedback 分类得存得住
Mem.addMemory(PK, { text: '被提醒：接话前先看上下文再答', category: 'feedback', importance: 0.55, origin: 'user' })
T('feedback 分类不再被归一成 event', Mem.listMemory(PK).some((x) => x.category === 'feedback'), Mem.listMemory(PK).map((x) => x.category))

// 又一次类似的纠正（措辞不同，但说的是同一件事）
Mem.addMemory(PK, { text: '被提醒：回答前先看看上下文，别硬接', category: 'feedback', importance: 0.55, origin: 'user' })

const date = D.dayStr()
const r = R.reflectDay(PK, date, { force: true })
T('复盘跑成功', r.ok === true, r)
T('复盘点出「同一个坑又踩了」', r.lines.some((x) => x.includes('又踩了一次')), r.lines)
T('点出的内容是那条纠正', r.lines.join('').includes('上下文'), r.lines)

// 只有一条反馈时不冤枉自己
const PK2 = peerKey('group', 'G-SCAR2')
Mem.addMemory(PK2, { text: '被提醒：接话前先看上下文再答', category: 'feedback', importance: 0.55, origin: 'user' })
const r2 = R.reflectDay(PK2, date, { force: true })
T('单条反馈不触发「又踩了」', !r2.lines.some((x) => x.includes('又踩了一次')), r2.lines)

console.log('=== 教训复盘测试 ===')
let fail = 0
for (const [n, p, d] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d))); if (!p) fail++ }
console.log(fail ? '失败 ' + fail : '全部通过')
try { rmSync(process.env.DSH_HOME, { recursive: true, force: true }) } catch {}
process.exit(fail ? 1 : 0)
