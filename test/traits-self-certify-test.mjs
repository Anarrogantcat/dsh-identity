// 自判封顶：自判跨 3 个不同天成立，就算她本来就这样；同一天说三遍不算
import { join } from 'node:path'
import { rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const HOME = process.env.TEMP.replace(/\\/g, '/') + '/dsh-test-self-certify'
try { rmSync(HOME, { recursive: true, force: true }) } catch {}
process.env.DSH_HOME = HOME
mkdirSync(HOME + '/profiles/desktop', { recursive: true })
writeFileSync(HOME + '/profiles/desktop/cordis.patch.yml', "- id: dsh-identity\n  config: {}\n", 'utf8')

const base = pathToFileURL(join(process.cwd(), 'lib')).href + '/'
const { ensureDirs } = await import(base + 'store.js')
const lc = await import(base + 'lifecycle.js')
ensureDirs()

const DAY = 86400000
const now = Date.now()
const day = (n) => new Date(now - n * DAY).toISOString()

const mk = (text) => ({ id: 't-' + text, text, status: 'tentative', evidence: [], confirmedBy: [], refutedBy: [], pinned: false })

const ok = []
const T = (n, c, e) => ok.push([n, !!c, e])

// 1) 自判 3 个不同天 → durable（certifiedBy=self）
let t = mk('自判三天')
for (const d of [2, 1, 0]) t = lc.addEvidence(t, { kind: 'decision', at: day(d) }, now, { crossGroupRequired: false })
t = lc.recompute(t, now, { crossGroupRequired: false })
T('自判 3 天升 durable', t.status === 'durable', t.status)
T('标明自己封的顶', t.certifiedBy === 'self', t.certifiedBy)
T('自判置信度不封满', (t.confidence ?? 1) <= 0.85 + 1e-9, t.confidence)

// 2) 同一天 3 条自判 → 不算
let t2 = mk('一天三遍')
for (let i = 0; i < 3; i++) t2 = lc.addEvidence(t2, { kind: 'decision', at: new Date(now - i * 60000).toISOString() }, now, { crossGroupRequired: false })
t2 = lc.recompute(t2, now, { crossGroupRequired: false })
T('同一天三遍不升 durable', t2.status === 'tentative', t2.status)

// 3) 只跨 2 天 → 不够
let t3 = mk('自判两天')
for (const d of [1, 0]) t3 = lc.addEvidence(t3, { kind: 'decision', at: day(d) }, now, { crossGroupRequired: false })
t3 = lc.recompute(t3, now, { crossGroupRequired: false })
T('自判 2 天不升 durable', t3.status === 'tentative', t3.status)

// 4) 真人认可仍然有效，且标 external
let t4 = mk('真人认可')
for (const d of [3, 2, 1]) t4 = lc.addEvidence(t4, { kind: 'feedback', at: day(d), by: 'u' + d }, now, { crossGroupRequired: false })
t4 = lc.confirmWith(t4, { ref: 'r1', by: 'user' }, now, { crossGroupRequired: false })
T('真人认可升 durable', t4.status === 'durable' && t4.certifiedBy === 'external', t4.status + '/' + t4.certifiedBy)

// 5) 被否两次 → 打回 tentative
let t5 = mk('被否')
for (const d of [2, 1, 0]) t5 = lc.addEvidence(t5, { kind: 'decision', at: day(d) }, now, { crossGroupRequired: false })
t5 = lc.recompute(t5, now, { crossGroupRequired: false })
t5 = lc.refuteWith(t5, { ref: 'x1', reason: '不是这样' }, now, { crossGroupRequired: false })
t5 = lc.refuteWith(t5, { ref: 'x2', reason: '又不对' }, now, { crossGroupRequired: false })
T('被否决两次打回 tentative', t5.status === 'tentative', t5.status)

let bad = 0
for (const [n, pass, e] of ok) { if (pass) console.log('OK  ' + n); else { bad++; console.log('FAIL ' + n + '  ' + String(JSON.stringify(e)).slice(0, 160)) } }
console.log(bad ? ('失败 ' + bad) : '全部通过')
process.exit(bad ? 1 : 0)
