/**
 * P5 记忆双卡测试：全量卡只存档、衰减卡注入 ≤300 字、水位提醒、pinned 不硬删
 */
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOME = mkdtempSync(join(tmpdir(), 'dsh-p5-'))
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
cfg.memory.injectTop = 3
cfg.memory.injectChars = 300
cfg.memory.maxPerPeer = 10

// 双卡：全量存档 vs 衰减卡
{
  M.addMemory(PK, { text: '小明说他下周要考试', importance: 0.8 }, cfg)
  M.addMemory(PK, { text: '群里约了周五开黑', importance: 0.5 }, cfg)
  M.addMemory(PK, { text: '我喜欢吃白饭', importance: 0.9 }, cfg)
  A('全量卡有 3 条', M.fullCard(PK).length === 3)
  A('衰减卡有 3 条', M.listMemory(PK).length === 3)
  const dup = M.addMemory(PK, { text: '小明说他下周要考试' }, cfg)
  A('重复提到只强化不重复存档', dup.hits === 2 && M.fullCard(PK).length === 3)
  A('全量卡文件存在', existsSync(join(dirs.memory, `${PK}.full.jsonl`)))
}

// 注入预算 ≤300 字
{
  const card = M.memoryCard(PK, cfg)
  A('注入卡不超过 300 字', card.length <= 300, card.length)
  A('注入卡有内容', card.includes('长期记忆'))
}

// 容量：到上限裁最不重要的，但 pinned 不裁；全量卡不丢
{
  for (let i = 0; i < 8; i++) M.addMemory(PK, { text: '琐事 ' + i, importance: 0.1 }, cfg)
  const items = M.listMemory(PK)
  A('衰减卡不超上限', items.length <= cfg.memory.maxPerPeer, items.length)
  A('全量卡完整保留', M.fullCard(PK).length === 11, M.fullCard(PK).length)
  const target = items[0]
  M.pinMemory(PK, target.id)
  for (let i = 0; i < 6; i++) M.addMemory(PK, { text: '更多琐事 ' + i, importance: 0.1 }, cfg)
  A('pinned 不会被裁掉', M.listMemory(PK).some((x) => x.id === target.id && x.pinned))
}

// 水位审计
{
  const ap = join(dirs.logs, 'audit.jsonl')
  const txt = existsSync(ap) ? readFileSync(ap, 'utf8') : ''
  A('水位有审计', /memory\.watermark/.test(txt), txt.slice(-200))
}

console.log('=== P5 记忆双卡测试 ===')
let fail = 0
for (const [n, p, d] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d))); if (!p) fail++ }
console.log(fail ? `失败 ${fail}` : '全部通过')
try { rmSync(HOME, { recursive: true, force: true }) } catch { /* ignore */ }
process.exitCode = fail ? 1 : 0
