/**
 * 复盘要产出一件「我想弄明白的事」，并挂到 open-topics，
 * 隔天主动开口时才有东西可问（接 autonomy 的好奇链）。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-curio-'))
delete process.env.QQBOT_REFINE_HOME
const url = (p) => new URL(p, import.meta.url).href
const { ensureStore } = await import(url('../lib/config.js'))
const { ensureDirs, dirs, peerKey, writeJson } = await import(url('../lib/store.js'))
const E = await import(url('../lib/events.js'))
const R = await import(url('../lib/reflection.js'))
const D = await import(url('../lib/diary.js'))
ensureStore(); ensureDirs()

const ok = []
const T = (n, p, d) => ok.push([n, !!p, d])
const PK = peerKey('group', 'G-CURIO')
const date = D.dayStr()

// 今天有 2 次是硬撑着回的（精力 → 复盘那条链）
const day = (() => { const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate() })()
writeJson(join(dirs.root, 'pace.json'), { energy: 0.2, at: new Date().toISOString(), stamps: [], streak: 0, tired: 2, tiredDay: day })

// 一条没人接住的问句（后面没有 bot 发言，才算「没接住」）
E.appendEvent(PK, { kind: 'talk', origin: 'inbound', who: '小明', text: '为什么精力总是不生效？', at: `${date}T10:00:00+08:00` })

const r = R.reflectDay(PK, date, { force: true })
T('复盘跑成功', r.ok === true, r)
T('复盘里有「我想弄明白」', r.lines.some((x) => x.includes('我想弄明白')), r.lines)
T('想弄明白的正是那件没接住的事', r.lines.join('').includes('精力'), r.lines)
T('复盘里有「硬撑」记录（精力→成长）', r.lines.some((x) => x.includes('硬撑着回')), r.lines)

// open-topics 落盘，隔天主动开口能取到
const p = join(dirs.root, 'open-topics.json')
const db = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : { peers: {} }
const arr = db.peers?.[PK] || []
T('挂进了 open-topics', arr.some((x) => String(x.text).includes('精力')), arr)

// 幂等：同一天再跑不重写
const r2 = R.reflectDay(PK, date)
T('复盘幂等', r2.skipped === true && r2.lines.some((x) => x.includes('我想弄明白')), r2)

console.log('=== 复盘好奇链测试 ===')
let fail = 0
for (const [n, p2, d] of ok) { console.log((p2 ? 'OK  ' : 'FAIL ') + n + (p2 ? '' : '   ' + JSON.stringify(d))); if (!p2) fail++ }
console.log(fail ? '失败 ' + fail : '全部通过')
try { rmSync(process.env.DSH_HOME, { recursive: true, force: true }) } catch {}
process.exit(fail ? 1 : 0)
