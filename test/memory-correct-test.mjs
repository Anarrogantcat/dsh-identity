/**
 * 记忆出处 + 改口：origin/quote/by、本鱼记的标出来、群友复述升级成事实、旧条作废不覆盖
 */
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOME = mkdtempSync(join(tmpdir(), 'dsh-mem-correct-'))
process.env.DSH_HOME = HOME
delete process.env.QQBOT_REFINE_HOME

const url = (p) => new URL(p, import.meta.url).href
const M = await import(url('../lib/memory.js'))
const { ensureStore, clone, DEFAULTS } = await import(url('../lib/config.js'))
const { ensureDirs, peerKey, dirs } = await import(url('../lib/store.js'))
ensureStore()
ensureDirs()

const ok = []
const A = (n, p, d) => ok.push([n, !!p, d])
const PK = peerKey('group', 'G1')
const cfg = clone(DEFAULTS)
cfg.memory.injectTop = 10
cfg.memory.injectChars = 2000

// 出处：群友说的 / 本鱼记的
{
  const u = M.addMemory(PK, { text: '小明下周三考试', origin: 'user', by: 'u1001', quote: '我下周三考试' }, cfg)
  const a = M.addMemory(PK, { text: '小明大概喜欢猫', source: 'marker' }, cfg)
  A('群友说的 origin=user', u.origin === 'user', u)
  A('marker 源默认算本鱼记的', a.origin === 'agent' && M.normalizeOrigin('', 'marker') === 'agent', a.origin)
  A('记了谁说的 + 原话', u.by === 'u1001' && u.quote === '我下周三考试', { by: u.by, quote: u.quote })
  A('默认 active', u.status === 'active')
}

// 注入：本鱼记的带标记，群友说的不带
{
  const card = M.memoryCard(PK, cfg)
  A('注入卡给推断的加标记', /\[本鱼记的\]\[[^\]]+\] 小明大概喜欢猫/.test(card), card)
  A('群友亲口的不加标记', /- \[[^\]]+\] 小明下周三考试/.test(card), card)
}

// 群友亲口复述 → 从推断升级为事实
{
  const before = M.listMemory(PK).find((x) => x.text === '小明大概喜欢猫')
  M.addMemory(PK, { text: '小明大概喜欢猫', origin: 'user', by: 'u1002' }, cfg)
  const after = M.listMemory(PK).find((x) => x.text === '小明大概喜欢猫')
  A('复述后升级成 user', before.origin === 'agent' && after.origin === 'user', after)
  A('升级后不再标[本鱼记的]', !/\[本鱼记的\][^\n]*喜欢猫/.test(M.memoryCard(PK, cfg)), M.memoryCard(PK, cfg))
}

// 改口：旧的作废，新的顶上，注入里只剩新的
{
  const r = M.correctMemory(PK, { keyword: '小明下周三考试', text: '小明下周四考试', by: 'u1001', cfg })
  A('改口成功', r.ok === true, r)
  const items = M.listMemory(PK)
  const old = items.find((x) => x.id === r.oldId)
  const fresh = items.find((x) => x.id === r.newId)
  A('旧条标 superseded 并指向新条', old?.status === 'superseded' && old.supersededBy === r.newId, old)
  A('新条 active 并指回旧条', fresh?.status === 'active' && fresh.supersedes === r.oldId, fresh)
  const card = M.memoryCard(PK, cfg)
  A('旧说法不再注入', !card.includes('下周三考试') && card.includes('下周四考试'), card)
  const rec = M.recall(PK, '考试', cfg, 10)
  A('检索也取不到旧的', !rec.some((x) => x.text === '小明下周三考试'), rec.map((x) => x.text))
}

// 找不到就不硬写
{
  const r = M.correctMemory(PK, { keyword: '压根没记过的事', text: '随便编的新说法', cfg })
  A('找不到旧条不乱写', r.ok === false && !M.listMemory(PK).some((x) => x.text === '随便编的新说法'), r)
}

// 旧数据没有 origin 字段：按 source 推回去
{
  const p = join(dirs.memory, `${PK}.json`)
  const db = JSON.parse(readFileSync(p, 'utf8'))
  db.items.push({ id: 'legacy1', text: '老记忆没有出处字段', category: 'fact', importance: 0.5, emotion: 0, valence: 0, at: new Date().toISOString(), createdAt: new Date().toISOString(), activation0: 1, activationAnchor: new Date().toISOString(), hits: 1, source: 'marker' })
  db.items.push({ id: 'legacy2', text: '老记忆是群聊里记的', category: 'fact', importance: 0.5, emotion: 0, valence: 0, at: new Date().toISOString(), createdAt: new Date().toISOString(), activation0: 1, activationAnchor: new Date().toISOString(), hits: 1, source: 'group' })
  writeFileSync(p, JSON.stringify(db), 'utf8')
  const items = M.listMemory(PK)
  A('老数据 marker 推出 agent', items.find((x) => x.id === 'legacy1')?.origin === 'agent')
  A('老数据 group 推出 user', items.find((x) => x.id === 'legacy2')?.origin === 'user')
}

// 忘掉照样能用（删除，不走改口）
{
  const n = M.forgetMemory(PK, { keyword: '小明下周四考试' })
  A('忘掉还能删', n === 1 && !M.listMemory(PK).some((x) => x.text === '小明下周四考试'), n)
}

console.log('=== 记忆出处 / 改口测试 ===')
let fail = 0
for (const [n, p, d] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d))); if (!p) fail++ }
console.log(fail ? `失败 ${fail}` : '全部通过')
try { rmSync(HOME, { recursive: true, force: true }) } catch { /* ignore */ }
process.exitCode = fail ? 1 : 0
