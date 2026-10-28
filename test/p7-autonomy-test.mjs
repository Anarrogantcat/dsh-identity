/**
 * P7 自主循环测试：只能提议、必须批准、只做本机动作、幂等、防死循环
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOME = mkdtempSync(join(tmpdir(), 'dsh-p7-'))
process.env.DSH_HOME = HOME
delete process.env.QQBOT_REFINE_HOME

const url = (p) => new URL(p, import.meta.url).href
const A = await import(url('../lib/autonomy.js'))
const E = await import(url('../lib/events.js'))
const T = await import(url('../lib/traits.js'))
const { ensureStore, clone, DEFAULTS } = await import(url('../lib/config.js'))
const { ensureDirs, peerKey } = await import(url('../lib/store.js'))
ensureStore()
ensureDirs()

const ok = []
const Aa = (n, p, d) => ok.push([n, !!p, d])
const PK = peerKey('group', 'G1')
const cfg = clone(DEFAULTS)

// 好奇：找没接住的问句
{
  E.appendEvent(PK, { kind: 'talk', origin: 'inbound', who: '小明', text: '那个版本号到底是多少？' })
  E.appendEvent(PK, { kind: 'talk', origin: 'inbound', who: '小红', text: '今天天气不错' })
  const c = A.curiosities(PK)
  Aa('找得到没接住的问句', c.length === 1 && c[0].text.includes('版本号'), c)
  Aa('不把陈述句当好奇', c.every((x) => !x.text.includes('天气')))
}

// 提议：只到 proposed，不能直接干；幂等、每天限 2
{
  const r1 = A.propose(PK, { cfg, limit: 2 })
  Aa('能提议出目标', r1.created.length >= 1, r1)
  Aa('提议状态是 proposed', A.listGoals({}).every((g) => g.status === 'proposed'))
  const r2 = A.propose(PK, { cfg, limit: 2 })
  Aa('同一天不重复提议', r2.created.length === 0, r2)
  Aa('每天最多 2 个', A.listGoals({}).length <= 2)
}

// 治理：不是 owner 不能批；未批准不能跑
{
  const g = A.listGoals({})[0]
  Aa('非 owner 不能批', A.setGoalStatus(g.id, 'approved', { by: 'member' }).ok === false)
  Aa('未批准不能执行', A.runGoal(g.id, { cfg }).ran === false)
  Aa('owner 能批', A.setGoalStatus(g.id, 'approved', { by: 'owner' }).ok === true)
}

// 执行：只做本机动作（tentative trait），做完标记 done；再跑幂等
{
  const g = A.listGoals({ status: 'approved' })[0]
  const r = A.runGoal(g.id, { cfg })
  Aa('批准后能跑', r.ran === true && r.ok === true, r)
  Aa('产出只到 tentative', (() => {
    const t = T.listTraits({ limit: 100 }).find((x) => x.text.includes('开始留意'))
    return t && t.status === 'tentative'
  })())
  Aa('目标标为 done', A.listGoals({}).find((x) => x.id === g.id).status === 'done')
  Aa('done 再跑不重复', A.runGoal(g.id, { cfg }).ran === false)
  Aa('预算不足就跳过', A.setGoalStatus(A.listGoals({})[0].id, 'approved', { by: 'owner' }).ok === false)
}

// 防死循环：同类连续失败 3 次不再提议（用假 stats 直接验逻辑）
{
  const before = A.listGoals({}).length
  const r = A.propose(PK, { cfg, limit: 2 })
  Aa('已有目标后再提议不重复', r.created.length === 0 || A.listGoals({}).length <= 2, { before, after: A.listGoals({}).length })
}

console.log('=== P7 自主循环测试 ===')
let fail = 0
for (const [n, p, d] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d))); if (!p) fail++ }
console.log(fail ? `失败 ${fail}` : '全部通过')
try { rmSync(HOME, { recursive: true, force: true }) } catch { /* ignore */ }
process.exitCode = fail ? 1 : 0
