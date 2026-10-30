/**
 * 记忆注入：动态阈值（断崖检测）+ 只强化真正进了提示词的那几条
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOME = mkdtempSync(join(tmpdir(), 'dsh-memdyn-'))
process.env.DSH_HOME = HOME
delete process.env.QQBOT_REFINE_HOME

const base = new URL('../', import.meta.url).href
const M = await import(base + 'lib/memory.js')
const { ensureStore, clone, DEFAULTS } = await import(base + 'lib/config.js')
const { ensureDirs, peerKey } = await import(base + 'lib/store.js')
ensureStore(); ensureDirs()

const ok = []
const A = (n, p, d) => ok.push([n, !!p, d])
const PK = peerKey('group', 'G1')
const cfg = clone(DEFAULTS)
cfg.memory.injectTop = 3
cfg.memory.injectChars = 2000
cfg.memory.injectGapRatio = 1.35
cfg.memory.injectFloor = 0.2
const sc = (ps) => ps.map((P, i) => ({ item: { text: 't' + i, at: new Date().toISOString() }, C: 1, P }))

// 固定模式：退化成前 N 条
{
  const c2 = clone(cfg); c2.memory.dynamicThreshold = false
  const r = M.pickInject(sc([0.9, 0.5, 0.48, 0.4]), c2)
  A('关掉动态 → 取满上限', r.picked.length === 3 && r.why === 'fixed', r)
}

// 断崖：第一名明显高于后面 → 只带一条
{
  const r = M.pickInject(sc([0.9, 0.5, 0.48]), cfg)
  A('断崖 → 只带 1 条', r.picked.length === 1 && r.why === 'gap', r.picked.length)
}

// 分数拉不开：带满
{
  const r = M.pickInject(sc([0.6, 0.59, 0.58]), cfg)
  A('分数接近 → 带满 3 条', r.picked.length === 3, r.picked.length)
}

// 最高分太弱：一条都不带
{
  const r = M.pickInject(sc([0.12, 0.1]), cfg)
  A('最高分低于地板 → 0 条', r.picked.length === 0 && r.why === 'below-floor', r)
}

// 相关度不够的（C 低）不参与
{
  const list = [{ item: { text: 'a' }, C: 0.05, P: 0.9 }, { item: { text: 'b' }, C: 1, P: 0.5 }]
  const r = M.pickInject(list, cfg)
  A('相关度不达标被剔除', r.picked.length === 1 && r.picked[0].item.text === 'b', r.picked.map((x) => x.item.text))
}

// 真数据：一条很重要 + 一堆普通的 → 只带重要的那条
{
  const now = Date.now()
  M.addMemory(PK, { text: '主人的生日是 3 月 14 日', category: 'stable_profile', importance: 0.95, origin: 'user', at: new Date(now).toISOString() }, cfg)
  for (let i = 0; i < 4; i++) M.addMemory(PK, { text: '普通琐事' + i, importance: 0.15, origin: 'user' }, cfg)
  const card = M.memoryCard(PK, cfg)
  const lines = card.split('\n').filter((l) => l.startsWith('- '))
  A('动态阈值下只带重要那条', lines.length === 1 && lines[0].includes('生日'), lines)
}

// 关掉动态：同一条数据会带满
{
  const c2 = clone(cfg); c2.memory.dynamicThreshold = false
  const lines = M.memoryCard(PK, c2).split('\n').filter((l) => l.startsWith('- '))
  A('关掉动态 → 带满 3 条', lines.length === 3, lines.length)
}

// 被砍掉的不该被强化
{
  const before = M.listMemory(PK).filter((x) => x.text.startsWith('普通琐事')).map((x) => x.hits)
  M.memoryCard(PK, cfg)
  const after = M.listMemory(PK).filter((x) => x.text.startsWith('普通琐事')).map((x) => x.hits)
  A('没被注入的条目不加分', before.every((h, i) => h === after[i]), { before, after })
}

// 决策要留痕（哪里能看到"这次为什么只带 1 条"）
{
  const { readFileSync, existsSync } = await import('node:fs')
  const { dirs } = await import(base + 'lib/store.js')
  const ap = join(dirs.logs, 'audit.jsonl')
  const txt = existsSync(ap) ? readFileSync(ap, 'utf8') : ''
  A('写了 memory.inject 审计', /"kind":"memory\.inject"/.test(txt) && /"why":"gap"/.test(txt), txt.slice(-200))
}

console.log('=== 记忆动态阈值测试 ===')
let fail = 0
for (const [n, p, d] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d))); if (!p) fail++ }
console.log(fail ? `失败 ${fail}` : '全部通过')
try { rmSync(HOME, { recursive: true, force: true }) } catch { /* ignore */ }
process.exitCode = fail ? 1 : 0
