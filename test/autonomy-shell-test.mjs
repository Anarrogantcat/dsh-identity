/**
 * 空壳目标防护：只有标点的「问句」不能变成目标，更不能变成认知。
 *
 * 事故现场（2026-11-01 前后的数据）：某次好奇候选文本就是「？」，propose 把它包成
 * 《把「？」这事弄明白》，runGoal 跑完又写成 durable 认知，稳定认知里多了两条空壳：
 *   · 我把「把「？」这事弄明白」弄明白了
 *   · 我开始留意：把「？」这事弄明白
 * 这里守三件事：候选过滤、旧脏目标自动丢弃、新目标只写一层模板。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOME = mkdtempSync(join(tmpdir(), 'dsh-shell-'))
process.env.DSH_HOME = HOME
delete process.env.QQBOT_REFINE_HOME

const url = (p) => new URL(p, import.meta.url).href
const A = await import(url('../lib/autonomy.js'))
const E = await import(url('../lib/events.js'))
const T = await import(url('../lib/traits.js'))
const { ensureStore, clone, DEFAULTS } = await import(url('../lib/config.js'))
const { ensureDirs, peerKey, dirs, readJson, writeJson } = await import(url('../lib/store.js'))
ensureStore()
ensureDirs()

const ok = []
const T_ = (n, p, d) => ok.push([n, !!p, d])
const PK = peerKey('group', 'G-SHELL')
const cfg = clone(DEFAULTS)
cfg.autonomy = { ...cfg.autonomy, autoInternal: true }

// 一：只有标点的「问句」不算好奇
{
  E.appendEvent(PK, { kind: 'talk', origin: 'inbound', who: '小明', text: '？' })
  E.appendEvent(PK, { kind: 'talk', origin: 'inbound', who: '小红', text: '？？？' })
  const c = A.curiosities(PK)
  T_('标点问句不进好奇', !c.some((x) => /^[?？\s]*$/.test(String(x.text))), c)
  const r = A.propose(PK, { cfg, limit: 2 })
  T_('标点问句不生成目标', r.created.length === 0, r)
}

// 二：@某人 + 问号也不算事；模板裹两层也要能剥到底
{
  T_('@加问号不算事', A.substantive('@1141291112 ？') === false)
  T_('正常问句带 @ 仍然算事', A.substantive('@1141291112 这个报错怎么修') === true)
  T_('双层模板剥到空', A.substantive(A.subjectOf({ title: '把「？」这事弄明白' })) === false)
  T_('单层模板剥出真问题', A.subjectOf({ title: '把「这个报错怎么修」这事弄明白' }) === '这个报错怎么修')
}

// 三：历史脏目标（没有 subject、标题是空壳）跑之前就被丢掉，且不产认知
{
  const before = T.listTraits({ limit: 200 }).length
  const db = { version: 1, goals: [{
    id: 'g_shell_legacy',
    peerKey: PK,
    kind: 'unanswered',
    title: '把「？」这事弄明白',
    why: '历史数据',
    status: 'approved',
    auto: true,
    createdAt: new Date().toISOString(),
    steps: [
      { id: 's1', text: 'read', kind: 'read', done: false },
      { id: 's2', text: 'note', kind: 'note', done: false },
      { id: 's3', text: 'handoff', kind: 'handoff', done: false },
    ],
  }], stats: {} }
  writeJson(join(dirs.root, 'autonomy.json'), db)
  const r = A.runGoal('g_shell_legacy', { cfg })
  T_('空壳目标不执行', r.ran === false, r)
  T_('空壳目标被丢弃', A.listGoals({}).find((g) => g.id === 'g_shell_legacy')?.status === 'dropped')
  const after = T.listTraits({ limit: 200 })
  T_('空壳目标不产认知', after.length === before && !after.some((t) => /^我把「把|开始留意：把/.test(String(t.text))), after.map((t) => t.text).slice(0, 5))
}

// 三：真问题照旧能跑，认知只包一层
{
  E.appendEvent(PK, { kind: 'talk', origin: 'inbound', who: '小蓝', text: '这个报错到底怎么修才好' })
  const r = A.propose(PK, { cfg, limit: 2 })
  T_('真问题能提议', r.created.length >= 1 && r.created[0].subject.includes('报错'), r)
  const g = A.listGoals({ status: 'approved' })[0]
  const run = A.runGoal(g.id, { cfg })
  T_('空跑不算做完', run.ran === true && run.ok === false && run.closed === false, run)
  const g2 = A.listGoals({}).find((x) => x.id === g.id)
  T_('空跑退回待跑并计数', g2?.status === 'approved' && g2?.attempts === 1, g2)
  const texts = T.listTraits({ limit: 200 }).map((t) => String(t.text))
  T_('认知只包一层', texts.includes('我开始留意：这个报错到底怎么修才好'), texts)
  T_('没有双层嵌套', !texts.some((t) => t.startsWith('我把「把')), texts)
  T_('空跑不发奖状', !texts.some((t) => t.startsWith('我把「这个报错')), texts)
}

console.log('=== 空壳目标防护测试 ===')
let fail = 0
for (const [n, p, d] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d))); if (!p) fail++ }
console.log(fail ? `失败 ${fail}` : '全部通过')
try { rmSync(HOME, { recursive: true, force: true }) } catch { /* ignore */ }
process.exitCode = fail ? 1 : 0
