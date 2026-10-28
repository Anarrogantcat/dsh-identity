/**
 * P1 身份核心测试：内核/风格/迁移 + traits 证据晋升 + 单一注入
 * 全部 import 仓库源码，DSH_HOME 指临时目录。
 */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOME = mkdtempSync(join(tmpdir(), 'dsh-p1-'))
process.env.DSH_HOME = HOME
delete process.env.QQBOT_REFINE_HOME

const url = (p) => new URL(p, import.meta.url).href
const I = await import(url('../lib/identity.js'))
const T = await import(url('../lib/traits.js'))
const { ensureStore, DEFAULTS, clone } = await import(url('../lib/config.js'))
const { ensureDirs, dirs, peerKey } = await import(url('../lib/store.js'))
ensureStore()
ensureDirs()

const ok = []
const A = (n, p, d) => ok.push([n, !!p, d])

// ── 1. 内核/场景/风格 ──
{
  const db = I.loadIdentity()
  A('默认风格 4 套', db.styles.length >= 4)
  A('默认当前风格 dm', db.currentStyle === 'dm')
  A('内核有底线', I.kernelText().includes('不装人'))
  const styles = I.listStyles()
  A('风格摘要可读', styles.styles.every((s) => s.id && s.name && s.chars > 0), styles.styles)
}

// ── 2. 旧人设库迁移（只读 + 幂等 + 备份）──
{
  const src = {
    version: 1,
    current: 'feiyu-group',
    presets: [
      { id: 'feiyu-group', name: '大肥鱼·群聊短句', text: '旧群聊正文', enabled: true },
      { id: 'custom-x', name: '自定义', text: '自定义正文', enabled: true },
    ],
    byGroup: { G1: 'feiyu-group-quiet' },
    byUser: {},
  }
  writeFileSync(join(dirs.root, 'presets.json'), JSON.stringify(src), 'utf8')
  const r1 = I.migrateFromPresets()
  A('迁移有变更', r1.moved >= 1, r1)
  const db = I.loadIdentity()
  A('feiyu-group → group 风格文本', db.styles.find((s) => s.id === 'group').text === '旧群聊正文')
  A('自定义 preset 变成风格', db.styles.some((s) => s.name === '自定义'))
  A('当前风格映射', db.currentStyle === 'group')
  A('按群作用域映射', db.byGroup.G1 === 'quiet', db.byGroup)
  A('备份只写一次', existsSync(join(dirs.root, 'identity-legacy.md')) && readFileSync(join(dirs.root, 'identity-legacy.md'), 'utf8').includes('旧群聊正文'))
  const r2 = I.migrateFromPresets()
  A('重复迁移幂等', r2.moved === 0, r2)
}

// ── 3. 风格解析与作用域 ──
{
  I.setCurrentStyle('dm')
  I.setStyleScope('group', 'G2', 'quiet')
  A('按群覆盖生效', I.resolveStyle('group', 'G2').id === 'quiet')
  A('未覆盖回落全局', I.resolveStyle('group', 'GX').id === 'dm')
  A('私聊默认风格', I.resolveStyle('c2c', 'U1').id === 'dm')
  I.setStyleScope('group', 'G2', '')
  A('清除覆盖回落', I.resolveStyle('group', 'G2').id === 'dm')
}

// ── 4. traits：一次只 tentative，跨 2 天 ≥3 次才 durable ──
{
  const day = (n) => new Date(Date.now() - n * 86400000).toISOString()
  let r = T.observe('喜欢被叫本鱼', { ref: 'e1', at: day(2) })
  A('第一次只有 tentative', r.status === 'tentative', r)
  r = T.observe('喜欢被叫本鱼', { ref: 'e2', at: day(1) })
  A('第二次还是 tentative', r.status === 'tentative', r)
  r = T.observe('喜欢被叫本鱼', { ref: 'e3', at: day(0) })
  A('三次跨两天 → durable', r.status === 'durable', r)
  const dup = T.observe('喜欢被叫本鱼', { ref: 'e3', at: day(0) })
  A('同 ref 不重复计数', dup.hits === 3, dup)

  // 纯情绪不够
  T.observe('今天有点烦', { ref: 'm1', kind: 'feeling', at: day(3) })
  T.observe('今天有点烦', { ref: 'm2', kind: 'feeling', at: day(1) })
  T.observe('今天有点烦', { ref: 'm3', kind: 'feeling', at: day(0) })
  const moodT = T.listTraits({ status: 'tentative' }).find((t) => t.text === '今天有点烦')
  A('纯情绪写不死成 durable', moodT && moodT.status === 'tentative', moodT)

  const promote = T.promoteTrait(moodT.id)
  A('证据不够时 Owner 也晋升不了', promote.ok === false, promote)
  const retire = T.retireTrait(moodT.id, 'test')
  A('Owner 能否决', retire.ok === true && T.listTraits({ limit: 100 }).find((t) => t.id === moodT.id)?.status === 'retired')
  A('否决后不注入', !T.durableLines({ limit: 20 }).some((l) => l.includes('烦')))
}

// ── 5. 自我卡只读迁移 ──
{
  mkdirSync(join(dirs.root, 'self'), { recursive: true })
  const pk = peerKey('group', 'G9')
  writeFileSync(join(dirs.root, 'self', `${pk}.json`), JSON.stringify({ self: [{ text: '我答应帮你查', at: new Date().toISOString(), kind: 'promise' }] }), 'utf8')
  const r = T.migrateSelfCards()
  A('自我卡迁出 tentative', r.migrated >= 1, r)
  A('迁移备份生成', existsSync(join(dirs.root, 'traits-legacy.md')))
  const r2 = T.migrateSelfCards()
  A('迁移按 ref 幂等', r2.migrated === 0, r2)
  A('自我卡文本进了 traits', T.listTraits({ limit: 100 }).some((t) => t.text === '我答应帮你查'))
}

// ── 6. 单一注入：durable 才进、预算硬上限 ──
{
  const a = I.composeIdentity({ scope: 'group', peer: 'G1', maxChars: 900 })
  A('注入含内核', a.text.includes('大肥鱼'))
  A('注入含 durable traits', a.text.includes('喜欢被叫本鱼'), a.text.slice(-200))
  A('注入不含 tentative', !a.text.includes('我答应帮你查'))
  const tiny = I.composeIdentity({ scope: 'group', maxChars: 400, parts: [] })
  A('预算严格', tiny.used <= 400, tiny.used)
  A('摘要与注入一致', I.kernelSummary().chars <= 900)
}

// ── 输出 ──
console.log('=== P1 身份核心测试 ===')
let fail = 0
for (const [n, p, d] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d))); if (!p) fail++ }
console.log(fail ? `失败 ${fail}` : '全部通过')
try { rmSync(HOME, { recursive: true, force: true }) } catch { /* ignore */ }
process.exitCode = fail ? 1 : 0
