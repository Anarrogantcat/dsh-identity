/**
 * 收口者：自主目标跑完必须真留下东西（判断卡 / 事实记忆 / 一次真提问），否则不许标 done。
 *
 * 以前的毛病：三步走完自动 done，顺手写一句「我把「X」这事弄明白了」当奖状，
 * 可 X 其实没人弄明白——判断卡一条没有，事实记忆一条没有，群里也没人问。
 * 这里守住四件事：
 *   1. 空跑不算 done，退回待跑、记一次数、隔 6 小时再试
 *   2. 连续 3 次空跑就丢掉这一类，别一直刷
 *   3. 真有产出（判断卡/事实记忆/真提问）才算收口
 *   4. 模板 note 写进 traits 的东西不算产出
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOME = mkdtempSync(join(tmpdir(), 'dsh-closer-'))
process.env.DSH_HOME = HOME
delete process.env.QQBOT_REFINE_HOME

const url = (p) => new URL(p, import.meta.url).href
const A = await import(url('../lib/autonomy.js'))
const M = await import(url('../lib/memory.js'))
const T = await import(url('../lib/traits.js'))
const { ensureStore, clone, DEFAULTS } = await import(url('../lib/config.js'))
const { ensureDirs, peerKey, dirs, readJson, writeJson } = await import(url('../lib/store.js'))
ensureStore()
ensureDirs()

const ok = []
const T_ = (n, p, d) => ok.push([n, !!p, d])
const cfg = clone(DEFAULTS)
cfg.autonomy = { ...cfg.autonomy, autoInternal: true }
const T0 = Date.now()
const HOUR = 3600 * 1000

const SUBJECT = '这个报错到底怎么修才好'

function seedGoal(pk, id, extra = {}) {
  const db = {
    version: 1,
    goals: [{
      id,
      peerKey: pk,
      kind: 'unanswered',
      subject: SUBJECT,
      title: `把「${SUBJECT}」这事弄明白`,
      why: '测试',
      status: 'approved',
      auto: true,
      createdAt: new Date(T0).toISOString(),
      steps: [
        { id: 's1', text: 'read', kind: 'read', done: false },
        { id: 's2', text: 'note', kind: 'note', done: false },
        { id: 's3', text: 'handoff', kind: 'handoff', done: false },
      ],
      ...extra,
    }],
    stats: {},
  }
  writeJson(join(dirs.root, 'autonomy.json'), db)
  return db
}

// 一：空跑不算 done，退回待跑，冷却期内不重跑
{
  const pk = peerKey('group', 'G-CLOSER-A')
  seedGoal(pk, 'g_empty')
  const r = A.runGoal('g_empty', { cfg, now: T0 })
  T_('空跑不算 done', r.ran === true && r.ok === false && r.closed === false, r)
  T_('空跑退回待跑', r.goal?.status === 'approved', r.goal)
  const g = A.listGoals({}).find((x) => x.id === 'g_empty')
  T_('空跑记了次数和下次时间', g?.attempts === 1 && !!g?.nextTryAt, g)
  const r2 = A.runGoal('g_empty', { cfg, now: T0 + 60000 })
  T_('冷却期内不重跑', r2.ran === false, r2)
  const texts = T.listTraits({ limit: 200 }).map((t) => String(t.text))
  T_('空跑不给奖状', !texts.some((t) => String(t).startsWith('我把「' + SUBJECT)), texts)
  T_('模板 note 只写自我提醒', texts.some((t) => String(t) === '我开始留意：' + SUBJECT), texts)
}

// 二：跑的时候真写了一条事实记忆 → 收口
{
  const pk = peerKey('group', 'G-CLOSER-B')
  seedGoal(pk, 'g_fact')
  M.addMemory(pk, { text: '这个报错的根因是插件版本对不上', category: 'fact', origin: 'user' })
  const r = A.runGoal('g_fact', { cfg, now: T0 - 120000 })
  T_('事实记忆算产出', r.ok === true && r.closed === true, r)
  T_('事实产出计数', r.evidence?.facts >= 1, r.evidence)
  T_('收口后是 done', r.goal?.status === 'done', r.goal)
  T_('done 才发奖状', T.listTraits({ limit: 200 }).some((t) => String(t.text) === '我把「' + SUBJECT + '」这事弄明白了'))
}

// 三：跑的时候真写了一条判断卡（agent 自己推的）→ 收口
{
  const pk = peerKey('group', 'G-CLOSER-C')
  seedGoal(pk, 'g_card')
  M.addMemory(pk, { text: '他偏好先看结论再听解释', category: 'preference', origin: 'agent', source: 'judge' })
  const r = A.runGoal('g_card', { cfg, now: T0 - 120000 })
  T_('判断卡算产出', r.ok === true && r.evidence?.cards >= 1, r)
}

// 四：真提问算产出；空提问不算
{
  const pk = peerKey('group', 'G-CLOSER-D')
  seedGoal(pk, 'g_ask')
  const r = A.runGoal('g_ask', { cfg, now: T0, asked: '这个报错是不是插件版本对不上？' })
  T_('真提问算产出', r.ok === true && r.evidence?.question === 1, r)

  const pk2 = peerKey('group', 'G-CLOSER-E')
  seedGoal(pk2, 'g_ask_empty')
  const r2 = A.runGoal('g_ask_empty', { cfg, now: T0, asked: '？' })
  T_('空提问不算产出', r2.ok === false, r2)
}

// 五：连续 3 次空跑 → 丢掉这一类，统计里留 3 次
{
  const pk = peerKey('group', 'G-CLOSER-F')
  seedGoal(pk, 'g_three')
  const outs = [T0, T0 + 7 * HOUR, T0 + 14 * HOUR].map((t) => A.runGoal('g_three', { cfg, now: t }))
  T_('前两次退回待跑', outs[0].goal?.status === 'approved' && outs[1].goal?.status === 'approved', outs.map((o) => o.goal))
  const g = A.listGoals({}).find((x) => x.id === 'g_three')
  T_('第三次空跑丢弃', g?.status === 'dropped' && g?.droppedBy === 'no-output', g)
  const db = readJson(join(dirs.root, 'autonomy.json'), null)
  T_('同类空跑计数 3', db?.stats?.[`${pk}|unanswered|fails`] === 3, db?.stats)
}

// 六：证据只算这次跑出来的，跑之前就有的记忆不算
{
  const pk = peerKey('group', 'G-CLOSER-G')
  seedGoal(pk, 'g_old')
  M.addMemory(pk, { text: '很久以前就记下的旧判断', category: 'fact', origin: 'user' })
  const old = A.evidenceSince(pk, Date.now() + 60000)
  T_('旧记忆不算本次产出', old.facts === 0 && old.cards === 0, old)
}

console.log('=== 收口者测试 ===')
let fail = 0
for (const [n, p, d] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d))); if (!p) fail++ }
console.log(fail ? `失败 ${fail}` : '全部通过')
try { rmSync(HOME, { recursive: true, force: true }) } catch { /* ignore */ }
process.exitCode = fail ? 1 : 0
