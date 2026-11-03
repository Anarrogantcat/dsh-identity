/**
 * 「已推翻」独立状态 + 改口唯一匹配。
 *
 * 两种死法不一样：
 *   · superseded  改口：有了新说法替换它，旧的指向新的
 *   · overturned  推翻：这件事本来就不是这样，没有替代品
 * 以前全塞进 superseded，面板上一个「已作废」糊过去，事后分不清是「对方改口了」还是「本鱼推错了」。
 *
 * 另一条来自 companion 的 old_text 规矩：关键词命中多条就拒绝，不拿第一条凑合——
 * 拿错一条的代价是把别人的事实改没了。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-overturn-'))
delete process.env.QQBOT_REFINE_HOME

const url = (p) => new URL(p, import.meta.url).href
const M = await import(url('../lib/memory.js'))
const { ensureStore, clone, DEFAULTS } = await import(url('../lib/config.js'))
const { ensureDirs, peerKey } = await import(url('../lib/store.js'))
ensureStore()
ensureDirs()

const ok = []
const T = (n, p, d) => ok.push([n, !!p, d])
const cfg = clone(DEFAULTS)
const PK = (x) => peerKey('group', x)

// 一、推翻：标状态、留痕、不删
{
  const pk = PK('ov-1')
  const item = M.addMemory(pk, { text: '他住在一楼', category: 'fact', origin: 'user', source: 'group' })
  const r = M.overturnMemory(pk, { id: item.id, reason: '后来确认是二楼', by: 'owner' })
  T('推翻成功', r.ok === true && r.id === item.id, r)
  const got = M.listMemory(pk).find((x) => x.id === item.id)
  T('状态是 overturned', got?.status === 'overturned', got?.status)
  T('记录时间和原因', !!got?.overturnedAt && String(got?.overturnReason).includes('二楼'), got)
  T('不删，还能查到', !!got && got.text === '他住在一楼')
  T('isLiveMemory 认它是死的', M.isLiveMemory(got) === false)
}

// 二、推翻的不再注入
{
  const pk = PK('ov-2')
  M.addMemory(pk, { text: '他喜欢先看结论再听解释', category: 'preference', origin: 'user', source: 'group' })
  M.addMemory(pk, { text: '他讨厌被催进度', category: 'preference', origin: 'user', source: 'group' })
  M.overturnMemory(pk, { keyword: '先看结论', reason: '记错了' })
  const card = M.memoryCard(pk, cfg)
  T('被推翻的不进注入', !card.includes('先看结论'), card)
  T('没被推翻的还在', card.includes('讨厌被催'), card)
}

// 三、改口和推翻是两回事
{
  const pk = PK('ov-3')
  const old = M.addMemory(pk, { text: '他养了只狗', category: 'fact', origin: 'user', source: 'group' })
  const r = M.correctMemory(pk, { id: old.id, text: '他养的是猫', by: 'owner' })
  T('改口成功', r.ok === true, r)
  const list = M.listMemory(pk)
  const sup = list.find((x) => x.id === old.id)
  T('改口标 superseded 并指向新条', sup?.status === 'superseded' && sup?.supersededBy === r.newId, sup)
  T('改口会多一条新说法', list.some((x) => x.id === r.newId && x.status === 'active'), list.map((x) => [x.id, x.status]))

  const pk2 = PK('ov-4')
  const a = M.addMemory(pk2, { text: '他每天七点起', category: 'fact', origin: 'user', source: 'group' })
  const before = M.listMemory(pk2).length
  M.overturnMemory(pk2, { id: a.id, reason: '其实不是' })
  const after = M.listMemory(pk2)
  T('推翻不新增条目', after.length === before, { before, after: after.length })
  T('推翻不指向新条', !after.find((x) => x.id === a.id)?.supersededBy, after.find((x) => x.id === a.id))
}

// 四、重复推翻是幂等的
{
  const pk = PK('ov-5')
  const a = M.addMemory(pk, { text: '他喜欢喝茶', category: 'preference', origin: 'user', source: 'group' })
  M.overturnMemory(pk, { id: a.id, reason: '一次' })
  const again = M.overturnMemory(pk, { id: a.id, reason: '两次' })
  T('重复推翻幂等', again.ok === true && again.already === true, again)
  T('原因不被覆盖', M.listMemory(pk).find((x) => x.id === a.id)?.overturnReason === '一次', M.listMemory(pk).find((x) => x.id === a.id))
}

// 五、关键词命中多条就拒绝（不拿第一条凑合）
{
  const pk = PK('ov-6')
  M.addMemory(pk, { text: '报错是插件版本不对', category: 'fact', origin: 'user', source: 'group' })
  M.addMemory(pk, { text: '报错也可能是网络断了', category: 'fact', origin: 'user', source: 'group' })
  const r = M.correctMemory(pk, { keyword: '报错', text: '报错是内存不够' })
  T('多条命中就拒绝', r.ok === false && /多条/.test(String(r.reason)), r)
  T('把候选列出来', Array.isArray(r.matches) && r.matches.length === 2, r.matches)
  const o = M.overturnMemory(pk, { keyword: '报错' })
  T('推翻同样拒绝多条', o.ok === false && /多条/.test(String(o.reason)), o)
}

// 六、唯一命中正常改；找不到就拒绝
{
  const pk = PK('ov-7')
  const a = M.addMemory(pk, { text: '他喜欢先看结论再听解释', category: 'preference', origin: 'user', source: 'group' })
  const r = M.correctMemory(pk, { keyword: '先看结论', text: '他喜欢先看数据' })
  T('唯一命中能改', r.ok === true && r.newId, r)
  const miss = M.correctMemory(pk, { keyword: '没有这句话', text: '随便写点' })
  T('找不到就拒绝', miss.ok === false, miss)
  T('原条已作废', M.listMemory(pk).find((x) => x.id === a.id)?.status === 'superseded')
}

console.log('=== 已推翻状态 + 改口唯一匹配 测试 ===')
let fail = 0
for (const [n, p, d] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d))); if (!p) fail++ }
console.log(fail ? `失败 ${fail}` : '全部通过')
try { rmSync(process.env.DSH_HOME, { recursive: true, force: true }) } catch { /* ignore */ }
process.exitCode = fail ? 1 : 0
