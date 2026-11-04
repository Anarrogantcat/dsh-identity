// 多群：一个人只有一套人格；单群反复算情境性，跨群一致才升 durable
import { join } from 'node:path'
import { rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const HOME = process.env.TEMP.replace(/\\/g, '/') + '/dsh-test-traits-crossgroup'
try { rmSync(HOME, { recursive: true, force: true }) } catch {}
process.env.DSH_HOME = HOME
mkdirSync(HOME + '/profiles/desktop', { recursive: true })
writeFileSync(HOME + '/profiles/desktop/cordis.patch.yml', "- id: dsh-identity\n  config: {}\n", 'utf8')

const base = pathToFileURL(join(process.cwd(), 'lib')).href + '/'
const { ensureDirs } = await import(base + 'store.js')
const { saveConfig, clone, DEFAULTS } = await import(base + 'config.js')
const L = await import(base + 'lifecycle.js')
const T = await import(base + 'traits.js')
ensureDirs()

const cfg = clone(DEFAULTS)
cfg.scope.groups = ['G-A', 'G-B']
saveConfig(cfg)

const ok = []
const eq = (n, c, e) => ok.push([n, !!c, e])
const DAY = 86400000
const t0 = Date.parse('2026-11-04T10:00:00Z')

// 统计里能数出群数
const st = L.evidenceStats([
  { at: new Date(t0).toISOString(), kind: 'feedback', by: 'u1', g: 'A' },
  { at: new Date(t0).toISOString(), kind: 'feedback', by: 'u2', g: 'A' },
  { at: new Date(t0 + DAY).toISOString(), kind: 'feedback', by: 'u3', g: 'B' },
])
eq('证据统计出 2 个群', st.groups === 2, st)

// 单群三个人 + 有人认过 → 仍是 tentative，标 contextual
const text = '我回话前习惯先看上下文，不按字面硬接'
T.observe(text, { ref: 'a1', kind: 'feedback', by: 'u1', g: 'G-A', at: new Date(t0).toISOString() })
T.observe(text, { ref: 'a2', kind: 'feedback', by: 'u2', g: 'G-A', at: new Date(t0 + 1000).toISOString() })
const one = T.observe(text, { ref: 'a3', kind: 'feedback', by: 'u3', g: 'G-A', at: new Date(t0 + 2000).toISOString() })
T.confirmTrait(one.id, { by: 'user', ref: 'm1' })
let got = T.listTraits({ limit: 100 }).find((x) => x.id === one.id)
eq('单群一致不升 durable', got && got.status === 'tentative', got && got.status)
eq('单群证据标成情境性', got && got.contextual === true, got && got.contextual)

// 另一群也这么说 → 跨群一致，升 durable
T.observe(text, { ref: 'b1', kind: 'feedback', by: 'u9', g: 'G-B', at: new Date(t0 + DAY).toISOString() })
got = T.listTraits({ limit: 100 }).find((x) => x.id === one.id)
eq('跨群一致后升 durable', got && got.status === 'durable', got && got.status)
eq('升了之后不再标情境性', got && !got.contextual, got && got.contextual)

let bad = 0
for (const [n, pass, e] of ok) {
  if (pass) console.log('OK  ' + n)
  else { bad++; console.log('FAIL ' + n + '  ' + String(JSON.stringify(e)).slice(0, 200)) }
}
console.log(bad ? ('失败 ' + bad) : '全部通过')
process.exit(bad ? 1 : 0)
