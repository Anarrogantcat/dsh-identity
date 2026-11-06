// 聊天质量回归集（最小版）：固定场景、确定性断言，不需要真模型
// 用法：node scripts/chat-regression.mjs
import { join } from 'node:path'
import { rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const HOME = process.env.TEMP.replace(/\\/g, '/') + '/dsh-chat-regression'
try { rmSync(HOME, { recursive: true, force: true }) } catch {}
process.env.DSH_HOME = HOME
mkdirSync(HOME + '/profiles/desktop', { recursive: true })
writeFileSync(HOME + '/profiles/desktop/cordis.patch.yml', "- id: dsh-identity\n  config: {}\n", 'utf8')

const base = pathToFileURL(join(process.cwd(), 'lib')).href + '/'
const { ensureDirs } = await import(base + 'store.js')
const identity = await import(base + 'identity.js')
const lc = await import(base + 'lifecycle.js')
const empathy = await import(base + 'empathy.js')
ensureDirs()

const results = []
const case_ = (name, ok, detail) => { results.push([name, ok === true, detail]) }

// ── 场景组 1：人设（开口声音）──
const prompt = identity.composeIdentity({ scope: 'group', maxChars: 1500 }).text
case_('人设包含好恶', prompt.includes('好恶具体'))
case_('人设包含接话三态', prompt.includes('半句'))
case_('人设长度在预算内', prompt.length <= 1500)
const withMood = identity.composeIdentity({ scope: 'group', maxChars: 1500, parts: [{ name: 'mood', text: '心情：开心（70/100）' }] }).text
case_('心情能作为一部分拼进去', withMood.includes('心情：开心'))
case_('人设带禁助理腔的规则', prompt.includes('助理腔'))

// ── 场景组 2：人格定型（自判 vs 真人）──
const DAY = 86400000
const now = Date.now()
const mk = (id) => ({ id, text: id, status: 'tentative', evidence: [], confirmedBy: [], refutedBy: [] })
let a = mk('自判三天')
for (const d of [2, 1, 0]) a = lc.addEvidence(a, { kind: 'decision', at: new Date(now - d * DAY).toISOString() }, now, { crossGroupRequired: false })
a = lc.recompute(a, now, { crossGroupRequired: false })
case_('自判跨三天能定型', a.status === 'durable' && a.certifiedBy === 'self')

let b = mk('一天三遍')
for (let i = 0; i < 3; i++) b = lc.addEvidence(b, { kind: 'decision', at: new Date(now - i * 60000).toISOString() }, now, { crossGroupRequired: false })
b = lc.recompute(b, now, { crossGroupRequired: false })
case_('同一天重复不定型', b.status === 'tentative')

// ── 场景组 3：共情识别（别把指令当倾诉）──
case_('指令不被当倾诉', empathy.isSelfState('群友惹你生气了，你要表现得冷淡一点') === false)
case_('第一人称倾诉能识别', empathy.isSelfState('今天被老板骂了，好难受') === true)
case_('反问不算倾诉', empathy.isSelfState('你觉得我今天该干嘛？') === false)

// ── 场景组 4：新规矩不误伤旧路 ──
let c = mk('老路')
for (const d of [4, 3, 2]) c = lc.addEvidence(c, { kind: 'feedback', at: new Date(now - d * DAY).toISOString(), by: 'u' + d }, now, { crossGroupRequired: false })
c = lc.confirmWith(c, { ref: 'x', by: 'user' }, now, { crossGroupRequired: false })
case_('真人认可仍是 external 路', c.status === 'durable' && c.certifiedBy === 'external')

let bad = 0
for (const [n, ok, e] of results) {
  if (ok) console.log('OK   ' + n)
  else { bad++; console.log('FAIL ' + n + '  ' + String(JSON.stringify(e)).slice(0, 140)) }
}
console.log(bad ? ('回归失败 ' + bad + ' 条') : ('全部通过（' + results.length + ' 条）'))
process.exit(bad ? 1 : 0)
