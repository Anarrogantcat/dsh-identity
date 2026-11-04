// 独立证据：按「天 × 来源」去重，来源=谁说的（老数据退回 kind）
import { join } from 'node:path'
import { rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const HOME = process.env.TEMP.replace(/\\/g, '/') + '/dsh-test-traits-indep'
try { rmSync(HOME, { recursive: true, force: true }) } catch {}
process.env.DSH_HOME = HOME
mkdirSync(HOME + '/profiles/desktop', { recursive: true })
writeFileSync(HOME + '/profiles/desktop/cordis.patch.yml', "- id: dsh-identity\n  config: {}\n", 'utf8')

const base = pathToFileURL(join(process.cwd(), 'lib')).href + '/'
const { ensureDirs } = await import(base + 'store.js')
const L = await import(base + 'lifecycle.js')
const T = await import(base + 'traits.js')
ensureDirs()

const ok = []
const eq = (n, c, e) => ok.push([n, !!c, e])
const DAY = 86400000
const t0 = Date.parse('2026-11-03T10:00:00Z')

// 1) 同一天、三个人说 → 三格
const threePeople = L.evidenceStats([
  { at: new Date(t0).toISOString(), kind: 'feedback', by: 'u1' },
  { at: new Date(t0 + 60000).toISOString(), kind: 'feedback', by: 'u2' },
  { at: new Date(t0 + 120000).toISOString(), kind: 'feedback', by: 'u3' },
])
eq('同一天三个人 = 3 格', threePeople.independent === 3, threePeople)

// 2) 同一天、同一个人刷三遍 → 一格
const onePerson = L.evidenceStats([
  { at: new Date(t0).toISOString(), kind: 'feedback', by: 'u1' },
  { at: new Date(t0 + 1000).toISOString(), kind: 'feedback', by: 'u1' },
  { at: new Date(t0 + 2000).toISOString(), kind: 'feedback', by: 'u1' },
])
eq('同一天同一个人 = 1 格', onePerson.independent === 1, onePerson)

// 3) 同一个人跨三天 → 三格（隔天算新证据）
const threeDays = L.evidenceStats([0, 1, 2].map((d) => ({ at: new Date(t0 + d * DAY).toISOString(), kind: 'feedback', by: 'u1' })))
eq('同一个人隔三天 = 3 格', threeDays.independent === 3, threeDays)

// 4) 老数据（没有 by）退回 kind 口径，仍能算
const legacy = L.evidenceStats([{ at: new Date(t0).toISOString(), kind: 'feedback' }])
eq('老数据退回 kind 不炸', legacy.independent === 1, legacy)

// 5) 端到端：三个人同一句 + 有人认过 → durable
const text = '我习惯先看上下文再回话，不按字面硬接'
const a = T.observe(text, { ref: 'r1', kind: 'feedback', by: 'u1', at: new Date(t0).toISOString() })
const b = T.observe(text, { ref: 'r2', kind: 'feedback', by: 'u2', at: new Date(t0 + 60000).toISOString() })
const c = T.observe(text, { ref: 'r3', kind: 'feedback', by: 'u3', at: new Date(t0 + 120000).toISOString() })
eq('三次证据后仍 tentative（还没人认）', c.status === 'tentative', c)
const conf = T.confirmTrait(a.id, { by: 'user', ref: 'manual-1' })
eq('有人认过后升 durable', conf && conf.ok !== false && (T.listTraits({ limit: 50 }).find((x) => x.id === a.id)?.status === 'durable'), conf)

// 6) 同一个人当天刷三遍 + 人认过 → 仍是 tentative（防刷）
const text2 = '我不太会主动找人聊天，习惯等别人先开口'
T.observe(text2, { ref: 's1', kind: 'feedback', by: 'u9', at: new Date(t0).toISOString() })
T.observe(text2, { ref: 's2', kind: 'feedback', by: 'u9', at: new Date(t0 + 1000).toISOString() })
const last = T.observe(text2, { ref: 's3', kind: 'feedback', by: 'u9', at: new Date(t0 + 2000).toISOString() })
T.confirmTrait(last.id, { by: 'user', ref: 'manual-2' })
const got = T.listTraits({ limit: 50 }).find((x) => x.id === last.id)
eq('同一个人刷三遍不升 durable', got && got.status === 'tentative', got && got.status)

let bad = 0
for (const [n, pass, e] of ok) {
  if (pass) console.log('OK  ' + n)
  else { bad++; console.log('FAIL ' + n + '  ' + String(JSON.stringify(e)).slice(0, 220)) }
}
console.log(bad ? ('失败 ' + bad) : '全部通过')
process.exit(bad ? 1 : 0)
