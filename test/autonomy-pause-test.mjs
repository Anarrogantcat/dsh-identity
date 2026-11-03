/**
 * 放一放：目标可以暂停，暂停时调度器不跑，捡回来还能接着跑。
 * 宿主那边有「已暂停的目标」，我们这套（autonomy.json）以前只有
 * proposed/approved/done/dropped/expired——累了想先搁一搁都没地方放。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOME = mkdtempSync(join(tmpdir(), 'dsh-pause-'))
process.env.DSH_HOME = HOME
delete process.env.QQBOT_REFINE_HOME

const url = (p) => new URL(p, import.meta.url).href
const A = await import(url('../lib/autonomy.js'))
const M = await import(url('../lib/memory.js'))
const E = await import(url('../lib/events.js'))
const { ensureStore, clone, DEFAULTS } = await import(url('../lib/config.js'))
const { ensureDirs, peerKey } = await import(url('../lib/store.js'))
ensureStore(); ensureDirs()

const ok = []
const T = (n, p, d) => ok.push([n, !!p, d])
const PK = peerKey('group', 'G-PAUSE')
const cfg = clone(DEFAULTS)
cfg.autonomy = { ...cfg.autonomy, autoInternal: false }

E.appendEvent(PK, { kind: 'talk', origin: 'inbound', who: '小明', text: '那个报错到底怎么修？' })
const r = A.propose(PK, { cfg, limit: 2 })
T('提议出目标', r.created.length === 1, r)
const id = r.created[0].id
T('owner 能批', A.setGoalStatus(id, 'approved', { by: 'owner' }).ok === true)

const p = A.pauseGoal(id, { by: 'self' })
T('能暂停', p.ok === true && p.goal.status === 'paused', p)
T('暂停后不在 approved 里', A.listGoals({ status: 'approved' }).length === 0)
T('暂停后跑不动', A.runGoal(id, { cfg }).ran === false)
T('暂停不是放弃（还在 listGoals 里）', A.listGoals({}).some((g) => g.id === id))

const rs = A.resumeGoal(id, { by: 'self' })
T('能捡回来', rs.ok === true && rs.goal.status === 'approved', rs)
// 真要收口得留下点东西：先记一条事实记忆，再把它跑完
M.addMemory(PK, { text: '这个报错的根因是版本对不上', category: 'fact', origin: 'user' })
T('捡回来能跑', A.runGoal(id, { cfg, now: Date.now() - 120000 }).ran === true)
T('有产出才算做完', A.listGoals({}).find((g) => g.id === id).status === 'done')
T('做完就不能再暂停', A.pauseGoal(id).ok === false)
T('没暂停的不能 resume', A.resumeGoal(id).ok === false)

const st = A.autonomyStats()
T('统计里看得到 paused 状态位', st.by && typeof st.by === 'object', st)

console.log('=== 自主目标暂停 测试 ===')
let fail = 0
for (const [n, p2, d] of ok) {
  console.log((p2 ? 'OK  ' : 'FAIL ') + n + (p2 ? '' : '   ' + JSON.stringify(d)))
  if (!p2) fail++
}
console.log(fail ? `失败 ${fail}` : '全部通过')
try { rmSync(HOME, { recursive: true, force: true }) } catch { /* ignore */ }
process.exit(fail ? 1 : 0)
