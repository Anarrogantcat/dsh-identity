/**
 * 记忆的两件旧账：置信度、巩固。
 *
 * 置信度：
 *   · 群友亲口说的 0.9 / 系统 0.8 / 本鱼自己推的 0.45 / 网上抄的 0.4
 *   · 本鱼推的、后来群友亲口确认了 → 抬到 ≥0.9；再被提起也会涨
 *   · 衰减按置信度加权：拿不准的淡得更快，别把猜测当结论记很久
 *
 * 巩固：
 *   · 7 天以上的「最近发生的事」压成一条摘要，原条标 consolidated：不再注入、不占名额
 *   · 偏好/事实/关系/承诺这些是「这个人是谁」，一条都不许压
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOME = mkdtempSync(join(tmpdir(), 'dsh-mem2-'))
process.env.DSH_HOME = HOME
delete process.env.QBOT_REFINE_HOME
delete process.env.QQBOT_REFINE_HOME

const url = (p) => new URL(p, import.meta.url).href
const M = await import(url('../lib/memory.js'))
const { ensureStore, clone, DEFAULTS } = await import(url('../lib/config.js'))
const { ensureDirs, peerKey, dirs, writeJson } = await import(url('../lib/store.js'))
ensureStore()
ensureDirs()

const ok = []
const T = (n, p, d) => ok.push([n, !!p, d])
const cfg = clone(DEFAULTS)
const DAY = 86400000
const PK = (x) => peerKey('group', x)

// ── 一、置信度按出处给 ──
{
  M.addMemory(PK('c-user'), { text: '他喜欢先看结论', category: 'preference', origin: 'user', source: 'group' })
  M.addMemory(PK('c-agent'), { text: '他可能喜欢先看结论', category: 'preference', origin: 'agent', source: 'judge' })
  M.addMemory(PK('c-web'), { text: '网上说这个插件好用', category: 'fact', origin: 'web', source: 'web' })
  const u = M.listMemory(PK('c-user'))[0]
  const a = M.listMemory(PK('c-agent'))[0]
  const w = M.listMemory(PK('c-web'))[0]
  T('群友说的置信度高', u?.confidence === 0.9, u?.confidence)
  T('本鱼推的置信度低', a?.confidence === 0.45, a?.confidence)
  T('网上抄的置信度最低', w?.confidence === 0.4, w?.confidence)
}

// ── 二、被确认 / 再提起，置信度上涨 ──
{
  const pk = PK('c-confirm')
  M.addMemory(pk, { text: '他大概讨厌长篇解释', category: 'preference', origin: 'agent', source: 'judge' })
  const before = M.listMemory(pk)[0].confidence
  M.addMemory(pk, { text: '他大概讨厌长篇解释', category: 'preference', origin: 'user', source: 'group' })
  const after = M.listMemory(pk)[0]
  T('亲口确认后抬到 0.9 以上', after.confidence >= 0.9, { before, after: after.confidence })
  T('确认后出处变群友', after.origin === 'user', after.origin)

  const pk2 = PK('c-repeat')
  M.addMemory(pk2, { text: '他每天中午在群里', category: 'fact', origin: 'user', source: 'group' })
  const c1 = M.listMemory(pk2)[0].confidence
  M.addMemory(pk2, { text: '他每天中午在群里', category: 'fact', origin: 'user', source: 'group' })
  const c2 = M.listMemory(pk2)[0].confidence
  T('再被提起置信度会涨', c2 > c1, { c1, c2 })
}

// ── 三、衰减按置信度加权：同样老、同样重要，拿不准的淡得更快 ──
{
  const pk = PK('c-decay')
  const at = new Date(Date.now() - 30 * DAY).toISOString()
  const base = { category: 'fact', importance: 0.5, emotion: 0, valence: 0, at, createdAt: at, activation0: 1, activationAnchor: at, status: 'active', source: 'group', pinned: false }
  writeJson(join(dirs.memory, `${pk}.json`), {
    items: [
      { ...base, id: 'hi', text: '确定的事', origin: 'user', confidence: 1 },
      { ...base, id: 'lo', text: '拿不准的事', origin: 'agent', confidence: 0.2 },
    ],
    df: {}, n: 2,
  })
  const list = M.listMemory(pk)
  const hi = list.find((x) => x.id === 'hi')
  const lo = list.find((x) => x.id === 'lo')
  T('高置信度淡得慢', hi.A > lo.A + 0.05, { hi: hi.A, lo: lo.A })
}

// ── 四、巩固：只压 event，人相关的条目不压 ──
{
  const pk = PK('g-consolidate')
  const old = (i, text, extra = {}) => ({
    id: 'o' + i, text, category: 'event', importance: 0.5, emotion: 0, valence: 0,
    at: new Date(Date.now() - (10 + i) * DAY).toISOString(),
    createdAt: new Date(Date.now() - (10 + i) * DAY).toISOString(),
    activation0: 1, activationAnchor: new Date(Date.now() - (10 + i) * DAY).toISOString(),
    status: 'active', source: 'group', origin: 'user', confidence: 0.9, pinned: false, hits: 1, ...extra,
  })
  const items = [
    old(1, '群里那天在聊抽卡'),
    old(2, '后来又聊到插件版本'),
    old(3, '有人说这周末一起打本'),
    old(4, '他讨厌别人催他', { category: 'preference', origin: 'user' }),
  ]
  writeJson(join(dirs.memory, `${pk}.json`), { items, df: {}, n: items.length })

  const r = M.consolidatePeer(pk, { cfg, minCount: 3 })
  T('旧事被巩固', r.ok === true && r.retired === 3, r)
  const list = M.listMemory(pk)
  const digest = list.find((x) => x.source === 'consolidate')
  T('压出一条摘要', !!digest && /条旧事/.test(digest.text), digest?.text)
  const retired = list.filter((x) => x.status === 'consolidated')
  T('原条标成 consolidated 但没删', retired.length === 3, retired.map((x) => x.text))
  const pref = list.find((x) => x.category === 'preference')
  T('偏好不许被压', pref?.status === 'active', pref?.status)

  const card = M.memoryCard(pk, cfg)
  T('摘要进卡、原话不再注入', card.includes('条旧事') && !card.includes('抽卡'), card)
}

// ── 五、不够数不压 ──
{
  const pk = PK('g-toofew')
  const at = new Date(Date.now() - 30 * DAY).toISOString()
  const one = { id: 'x1', text: '只有一条旧事', category: 'event', importance: 0.5, emotion: 0, valence: 0, at, createdAt: at, activation0: 1, activationAnchor: at, status: 'active', source: 'group', origin: 'user', confidence: 0.9, pinned: false }
  writeJson(join(dirs.memory, `${pk}.json`), { items: [one], df: {}, n: 1 })
  const r = M.consolidatePeer(pk, { cfg })
  T('旧事太少不压', r.retired === 0 && r.reason === 'too-few', r)
  T('并说明是候选不够', r.candidates === 1, r.candidates)
}

// ── 六、压过的不会再被压一次 ──
{
  const pk = PK('g-twice')
  const mk = (i) => ({
    id: 't' + i, text: '旧事' + i, category: 'event', importance: 0.5, emotion: 0, valence: 0,
    at: new Date(Date.now() - (9 + i) * DAY).toISOString(),
    createdAt: new Date(Date.now() - (9 + i) * DAY).toISOString(),
    activation0: 1, activationAnchor: new Date(Date.now() - (9 + i) * DAY).toISOString(),
    status: 'active', source: 'group', origin: 'user', confidence: 0.9, pinned: false,
  })
  writeJson(join(dirs.memory, `${pk}.json`), { items: [mk(1), mk(2), mk(3)], df: {}, n: 3 })
  const r1 = M.consolidatePeer(pk, { cfg, minCount: 3 })
  const r2 = M.consolidatePeer(pk, { cfg, minCount: 3 })
  T('第一次压了 3 条', r1.retired === 3, r1)
  T('第二次不会重复压', r2.retired === 0, r2)
}

console.log('=== 记忆置信度 + 巩固 测试 ===')
let fail = 0
for (const [n, p, d] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d))); if (!p) fail++ }
console.log(fail ? `失败 ${fail}` : '全部通过')
try { rmSync(HOME, { recursive: true, force: true }) } catch { /* ignore */ }
process.exitCode = fail ? 1 : 0
