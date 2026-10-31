/** 外部人格文件：自动同步、缓存、上次成功兜底与 3000/4000 预算。 */
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-persona-file-'))
delete process.env.QQBOT_REFINE_HOME

const url = (p) => new URL(p, import.meta.url).href
const { STORE_DIR, DEFAULTS, ensureStore } = await import(url('../lib/config.js'))
const I = await import(url('../lib/identity.js'))
ensureStore()

const ok = []
const T = (name, pass, detail) => ok.push([name, !!pass, detail])
const dir = join(STORE_DIR, 'personas')
const file = join(dir, 'persona.md')
mkdirSync(dir, { recursive: true })

const marker = '【1383字人格结尾】'
let personaCore = '# 测试人格\n'
while (personaCore.length < 1383 - marker.length) personaCore += '自然、具体、口语化。'
const persona = personaCore.slice(0, 1383 - marker.length) + marker
writeFileSync(file, '\uFEFF' + persona.replace(/\n/g, '\r\n'), 'utf8')

const cfg = {
  identity: {
    baseTextFile: 'personas/persona.md',
    baseText: '这段内联内容不应覆盖人格文件。',
    baseTextMaxChars: DEFAULTS.identity.baseTextMaxChars,
    maxChars: DEFAULTS.identity.maxChars,
  },
}

T('默认基础人格预算为 3000', DEFAULTS.identity.baseTextMaxChars === 3000, DEFAULTS.identity.baseTextMaxChars)
T('默认身份总预算为 4000', DEFAULTS.identity.maxChars === 4000, DEFAULTS.identity.maxChars)

for (const scope of ['web', 'group', 'c2c']) {
  const out = I.composeConfiguredIdentity(cfg, { scope })
  T(`${scope} 读取同一个人格文件`, out.personaSource === 'file' && out.text.includes(marker), out)
  T(`${scope} 不混入内联备用`, !out.text.includes('这段内联内容'), out.text.slice(0, 120))
  T(`${scope} 完整容纳 1383 字人格`, out.used <= 4000 && out.text.includes(marker), out.used)
}

const original = I.composeConfiguredIdentity(cfg, { scope: 'c2c' }).text
const changed = persona.replace(marker, '【文件已同步】') + 'v2'
writeFileSync(file, changed, 'utf8')
const future = new Date(Date.now() + 3000)
utimesSync(file, future, future)
const updated = I.composeConfiguredIdentity(cfg, { scope: 'c2c' }).text
T('同进程编辑后下一轮自动更新', updated.includes('【文件已同步】') && updated !== original, updated.slice(-80))

writeFileSync(file, '', 'utf8')
const empty = I.composeConfiguredIdentity(cfg, { scope: 'c2c' })
T('空文件保留上次成功人格', empty.text.includes('【文件已同步】') && empty.personaFileState === 'last-good', empty.personaFileState)

unlinkSync(file)
const missing = I.composeConfiguredIdentity(cfg, { scope: 'c2c' })
T('文件暂时不存在仍保留上次成功人格', missing.text.includes('【文件已同步】'), missing.personaFileState)

const fallbackCfg = {
  identity: {
    baseTextFile: 'personas/never-existed.md',
    baseText: '【内联兜底人格】',
    baseTextMaxChars: 3000,
    maxChars: 4000,
  },
}
const fallback = I.composeConfiguredIdentity(fallbackCfg, { scope: 'web' })
T('无可用文件时回退内联人格', fallback.personaSource === 'inline' && fallback.text.includes('【内联兜底人格】'), fallback)

const long = '甲'.repeat(2990) + '【三千字上限结尾】'
const longOut = I.composeIdentity({ baseText: long, baseTextMaxChars: 3000, maxChars: 4000, scope: 'group' })
T('基础人格上限可容纳三千字', longOut.text.includes('【三千字上限结尾】'), longOut.used)
T('身份提示词总预算不超过四千', longOut.used <= 4000, longOut.used)

console.log('=== 人格文件与预算测试 ===')
let fail = 0
for (const [name, pass, detail] of ok) {
  console.log((pass ? 'OK  ' : 'FAIL ') + name + (pass ? '' : '   ' + JSON.stringify(detail)))
  if (!pass) fail++
}
console.log(fail ? ('失败 ' + fail) : '全部通过')
try { rmSync(process.env.DSH_HOME, { recursive: true, force: true }) } catch { /* ignore */ }
process.exit(fail ? 1 : 0)

