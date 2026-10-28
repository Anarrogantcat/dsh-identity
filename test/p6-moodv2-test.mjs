/**
 * P6 心情 v2 测试：七情六欲打分、复合情绪、衰减、注入块只改语气
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOME = mkdtempSync(join(tmpdir(), 'dsh-p6-'))
process.env.DSH_HOME = HOME
delete process.env.QQBOT_REFINE_HOME

const url = (p) => new URL(p, import.meta.url).href
const V = await import(url('../lib/moodv2.js'))
const { ensureStore } = await import(url('../lib/config.js'))
const { ensureDirs } = await import(url('../lib/store.js'))
ensureStore()
ensureDirs()

const ok = []
const A = (n, p, d) => ok.push([n, !!p, d])
const BASE = 0.3

// 初始七情六欲齐
{
  const s = V.getState()
  A('七情齐全', V.SEVEN.every((k) => typeof s.seven[k] === 'number'), V.SEVEN)
  A('六欲齐全', V.NEEDS.every((k) => typeof s.needs[k] === 'number'), V.NEEDS)
  A('初始贴基线', Math.abs(s.seven.joy - BASE) < 0.05)
}

// 夸 → 喜/被尊重；骂 → 怒/恶
{
  const a = V.note('谢谢，好厉害，太专业了', { role: 'member' })
  A('被夸 → 喜上升', a.state.seven.joy > BASE + 0.1, a.state.seven)
  A('被夸 → 尊重上升', a.state.needs.respect > BASE + 0.05)
  V.reset()
  const b = V.note('滚，傻，烦死了', { role: 'member' })
  A('被骂 → 怒上升', b.state.seven.anger > BASE + 0.1, b.state.seven)
  A('被骂 → 恶上升', b.state.seven.disgust > BASE)
}

// 复合情绪：爱＋怒 = 别扭
{
  V.reset()
  for (let i = 0; i < 3; i++) V.note('爱你，抱抱，贴贴', {})
  for (let i = 0; i < 2; i++) V.note('滚，烦，傻', {})
  const b = V.blendsOf(V.getState()).map((x) => x.label)
  A('复合出「别扭」', b.includes('别扭'), b)
}

// 衰减：24 小时后回落到基线附近
{
  V.reset()
  V.note('爱你抱抱贴贴', {})
  const now = Date.now()
  const s0 = V.getState(now)
  const s1 = V.getState(now + 24 * 3600000)
  A('24 小时会衰减', s1.seven.love < s0.seven.love && Math.abs(s1.seven.love - BASE) < 0.1, [s0.seven.love, s1.seven.love])
}

// 注入块：≤120 字、说明只改语气
{
  V.reset()
  for (let i = 0; i < 3; i++) V.note('爱你，抱抱', {})
  for (let i = 0; i < 2; i++) V.note('滚，傻', {})
  const tb = V.toneBlock(V.getState(), { chars: 120 })
  A('心情块不超字数', tb.length <= 120, tb.length)
  A('心情块声明只改语气', tb.includes('只影响怎么说'))
  A('没复合情绪就不注入', V.toneBlock(Object.fromEntries([['seven', V.SEVEN.reduce((o, k) => ({ ...o, [k]: BASE }), {})], ['needs', V.NEEDS.reduce((o, k) => ({ ...o, [k]: BASE }), {})]])) === '')
}

console.log('=== P6 心情 v2 测试 ===')
let fail = 0
for (const [n, p, d] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d))); if (!p) fail++ }
console.log(fail ? `失败 ${fail}` : '全部通过')
try { rmSync(HOME, { recursive: true, force: true }) } catch { /* ignore */ }
process.exitCode = fail ? 1 : 0
