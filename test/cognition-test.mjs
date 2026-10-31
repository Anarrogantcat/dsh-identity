import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
process.env.DSH_HOME = process.env.DSH_HOME || 'C:/dsh-test-temp/dsh-test-cog'
const base = new URL('../', import.meta.url).href;
const fs = await import('node:fs')
const path = await import('node:path')
const C = await import(base + 'lib/config.js')
const S = await import(base + 'lib/store.js')
const R = await import(base + 'lib/relations.js')
const K = await import(base + 'lib/cards.js')
const D = await import(base + 'lib/digest.js')
const STORE = C.STORE_DIR
fs.rmSync(STORE, { recursive: true, force: true }) // 每次重跑从干净状态开始
S.ensureDirs()
const ok = []
function t(name, cond) { ok.push([name, !!cond]) }
const rawWrite = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s, 'utf8') }
const rawRead = (p) => { try { return fs.readFileSync(p, 'utf8') } catch { return '' } }
const now = Date.now()
const MIN = 60000
const HOUR = 3600000
const DAY = 86400000

// ── 1. 关系累计 + 名字更新 ──
const P1 = 'g_relA'
R.recordInteraction(P1, 'u-a', { name: '染喵', kind: 'chat' })
R.recordInteraction(P1, 'u-a', { kind: 'mention' })
let rows = R.relationsOf(P1, 6)
t('互动次数累计为 2', rows.length === 1 && rows[0].count === 2)
R.recordInteraction(P1, 'u-a', { name: '' })
rows = R.relationsOf(P1, 6)
t('空名字不覆盖旧名', rows[0].name === '染喵')
R.recordInteraction(P1, 'u-a', { name: '染喵喵' })
t('非空名字覆盖旧名', R.relationsOf(P1, 6)[0].name === '染喵喵')
t('kind 分类累计', R.relationsOf(P1, 6)[0].kinds.chat === 1 && R.relationsOf(P1, 6)[0].kinds.mention === 1)

// ── 2. 加权排序：同样 2 次，最近的排前面 ──
const PW = 'g_weight'
R.recordInteraction(PW, 'u-old', { name: '老消息', at: now - 30 * DAY })
R.recordInteraction(PW, 'u-old', { name: '老消息', at: now - 30 * DAY })
R.recordInteraction(PW, 'u-new', { name: '新消息', at: now })
R.recordInteraction(PW, 'u-new', { name: '新消息', at: now })
const wrows = R.relationsOf(PW, 6)
t('时间新鲜度参与排序', wrows[0].uid === 'u-new' && wrows[0].count === wrows[1].count)
t('排序带 score 字段', wrows[0].score > wrows[1].score)
t('n 参数截断', R.relationsOf(PW, 1).length === 1)

// ── 3. presenceCard 文本 ──
const cardP1 = R.presenceCard(P1, 5)
t('在场卡标题', cardP1.includes('# 在场的人（按最近活跃）'))
t('在场卡带今天句数', cardP1.includes('今天说过 4 句'))
R.recordInteraction('g_role', 'u-o', { name: '染喵', role: 'owner' })
t('群主标记可读', R.presenceCard('g_role', 5).includes('染喵（群主）'))
R.recordInteraction('g_role', 'u-m', { name: '牛大哥', role: 'admin' })
t('管理员标记可读', R.presenceCard('g_role', 5).includes('牛大哥（管理员）'))
t('在场卡人数截断', R.presenceCard(P1, 1).split('\n').length === 2)

// ── 4. 关系图 nodes/edges（同一分钟共现）──
const PG = 'g_graph'
const mbase = Math.floor(now / MIN) * MIN + 10000
R.recordInteraction(PG, 'u-a', { name: 'A', at: mbase })
R.recordInteraction(PG, 'u-b', { name: 'B', at: mbase + 2000 })
const g1 = R.relationGraph(PG, 12)
t('关系图 2 个节点', g1.nodes.length === 2)
t('同一分钟产生 1 条边', g1.edges.length === 1 && g1.edges[0].weight === 1)
const PX = 'g_nograph'
R.recordInteraction(PX, 'u-a', { name: 'A', at: mbase })
R.recordInteraction(PX, 'u-b', { name: 'B', at: mbase + 3 * MIN })
t('不同分钟没有边', R.relationGraph(PX, 12).edges.length === 0)
t('关系图节点带名字', R.relationGraph(PG, 12).nodes.every((n) => typeof n.name === 'string'))

// ── 5. 自我卡：自述 / 承诺 ──
const PS = 'g_self'
t('空自我卡返回空串', K.selfCard(PS) === '')
K.noteSelf(PS, '我明天帮你查赛程。我押 HLE。')
const sc = K.selfCard(PS)
t('自我卡标题', sc.includes('# 我刚才说过/答应过'))
t('承诺句进答应过', sc.includes('答应过：我明天帮你查赛程'))
t('自述句进说过', sc.includes('说过：我押 HLE'))
K.noteSelf(PS, '嗯嗯好的')
t('无自述词的句子被丢弃', !K.selfCard(PS).includes('嗯嗯好的'))
for (let i = 0; i < 25; i++) K.noteSelf(PS, '我记住第 ' + i + ' 件事')
const selfRaw = JSON.parse(rawRead(path.join(STORE, 'self', PS + '.json')))
t('自我卡最多 20 条', selfRaw.self.length === 20)
const ss = K.selfStats()
t('自我卡统计：条目数 > 0', ss.items >= 20, ss)
t('自我卡统计：有最近更新时间', ss.lastAt > 0, ss)
t('自我卡统计：会话数 ≥ 1', ss.peers >= 1, ss)

// ── 6. 待办卡：记录 / 取出 / 不重复 / 过期 ──
const PT = 'g_todo'
t('空待办卡返回空串', K.todoCard(PT) === '')
K.noteMissed(PT, { sender: 'u-a', name: '染喵', text: '大肥鱼你说说分析', at: now - 5 * MIN })
const tc = K.todoCard(PT)
t('待办卡标题', tc.includes('# 还没答完的'))
t('待办卡带时间和原话', tc.includes('5 分钟前「大肥鱼你说说分析」') && tc.includes('当时在冷却没回'))
const got1 = K.takeTodos(PT, 30)
t('待办取出 1 条', got1.length === 1 && got1[0].text === '大肥鱼你说说分析')
t('取完待办卡变空', K.todoCard(PT) === '')
t('取出后不再重复', K.takeTodos(PT, 30).length === 0)
K.noteMissed(PT, { sender: 'u-b', name: '牛大哥', text: '在吗', at: now - 61 * MIN })
t('过期待办不返回', K.takeTodos(PT, 30).length === 0)
K.noteMissed(PT, { sender: 'u-c', name: '小c', text: '叫一下鱼', at: now - 2 * MIN })
for (let i = 0; i < 12; i++) K.noteMissed(PT, { sender: 'u-' + i, name: 'x', text: '刷屏 ' + i + ' ' + now, at: now - 60000 })
const todoRaw = JSON.parse(rawRead(path.join(STORE, 'todos', PT + '.json')))
t('待办最多 10 条', todoRaw.items.length === 10)

// ── 7. cognitiveBlock 拼接与长度上限 ──
const PB = 'g_block'
R.recordInteraction(PB, 'u-a', { name: '染喵', role: 'owner' })
K.noteSelf(PB, '我明天帮你查赛程')
K.noteMissed(PB, { sender: 'u-a', name: '染喵', text: '大肥鱼你说说分析', at: now - 3 * MIN })
const block = K.cognitiveBlock(PB, {})
t('汇总含三张卡', block.includes('# 在场的人') && block.includes('# 我刚才说过/答应过') && block.includes('# 还没答完的'))
t('汇总长度 ≤600', [...block].length <= 600)
const shortBlock = K.cognitiveBlock(PB, { cognition: { blockChars: 80 } })
t('汇总可配长度上限', [...shortBlock].length <= 80)
t('全空返回空串', K.cognitiveBlock('g_empty_peer', {}) === '')

// ── 8. digest：节流、摘要、进出 ──
const PD = 'g_digest'
const chatter = ['今天比赛真好看', 'HLE 上路有点问题', '明天还打不打', '今天比赛真好看', '这个阵容看不懂', '今天比赛真好看']
for (const s of chatter) D.note(PD, { sender: 'u-a', name: '染喵', text: s, at: now })
const c1 = D.maybeConsolidate(PD, now)
t('攒够 5 条首次巩固成功', c1.ok === true && typeof c1.summary === 'string')
t('摘要 ≤50 字', [...String(c1.summary ?? '')].length <= 50)
t('摘要非空', String(c1.summary ?? '').length > 0)
for (let i = 0; i < 5; i++) D.note(PD, { sender: 'u-a', name: '染喵', text: '又聊了起来 ' + i, at: now + 1000 })
const c2 = D.maybeConsolidate(PD, now + 1000)
t('1 小时内第二次被节流', c2.ok === false && String(c2.reason).includes('1 小时'))
const c3 = D.maybeConsolidate(PD, now + HOUR + 1)
t('满 1 小时后可再巩固', c3.ok === true)
const c4 = D.maybeConsolidate(PD, now + HOUR + 2)
t('第二次刚巩固完又不足 5 条', c4.ok === false)
const pdCard = D.digestOf(PD, 1)
t('摘要卡有标题和日期行', pdCard.includes('# 群里最近在聊') && /· \d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(pdCard))
const pdRaw = JSON.parse(rawRead(path.join(STORE, 'digest', PD + '.json')))
t('摘要落盘 retain ≤60', Array.isArray(pdRaw.summaries) && pdRaw.summaries.length <= 60)
D.note('g_bigdigest', { sender: 'u-a', name: 'A', text: '第一条', at: now })
for (let i = 0; i < 260; i++) D.note('g_bigdigest', { sender: 'u-a', name: 'A', text: '灌水第 ' + i + ' 句', at: now })
const bigRaw = JSON.parse(rawRead(path.join(STORE, 'digest', 'g_bigdigest.json')))
t('环形缓冲最多 200 条', bigRaw.items.length === 200)

// ── 9. 跨 peer 隔离 ──
const PA = 'g_isoA'
const PBB = 'g_isoB'
R.recordInteraction(PA, 'u-a', { name: '甲' })
R.recordInteraction(PBB, 'u-b', { name: '乙' })
t('关系数据跨群隔离', R.relationsOf(PA, 6).every((x) => x.uid !== 'u-b') && R.relationsOf(PBB, 6).every((x) => x.uid !== 'u-a'))
t('关系图跨群隔离', R.relationGraph(PA, 12).nodes.length === 1 && R.relationGraph(PBB, 12).nodes.length === 1)
K.noteSelf(PA, '我会帮你盯着')
t('自我卡跨群隔离', K.selfCard(PA).includes('我会帮你盯着') && K.selfCard(PBB) === '')
K.noteMissed(PA, { sender: 'u-a', name: '甲', text: '叫鱼甲', at: now - MIN })
t('待办跨群隔离', K.takeTodos(PA, 30).length === 1 && K.takeTodos(PBB, 30).length === 0)
D.note(PA, { sender: 'u-a', name: '甲', text: '甲群聊天', at: now })
t('摘要跨群隔离', D.digestOf(PBB, 1) === '')

// ── 10. 坏文件容错 ──
const PC = 'g_corrupt'
const bad = '{{{ 这不是 JSON'
rawWrite(path.join(STORE, 'relations', PC + '.json'), bad)
rawWrite(path.join(STORE, 'self', PC + '.json'), bad)
rawWrite(path.join(STORE, 'todos', PC + '.json'), bad)
rawWrite(path.join(STORE, 'digest', PC + '.json'), bad)
let crashed = false
let safe = null
try {
  safe = { r: R.relationsOf(PC, 6), p: R.presenceCard(PC, 5), g: R.relationGraph(PC, 12), s: K.selfCard(PC), td: K.todoCard(PC), cb: K.cognitiveBlock(PC, {}), dg: D.digestOf(PC, 1), c: D.maybeConsolidate(PC, now) }
} catch (e) { crashed = true }
t('坏文件不抛异常', !crashed)
t('坏文件读出空数据', safe && safe.r.length === 0 && safe.p === '' && safe.g.edges.length === 0 && safe.s === '' && safe.td === '' && safe.cb === '' && safe.dg === '')
t('坏文件统计不炸', typeof R.relationsStats().people === 'number' && typeof D.digestStats().items === 'number')
t('坏文件写入可自愈', R.recordInteraction(PC, 'u-a', { name: '复活' }) && R.relationsOf(PC, 6).length === 1)

// ── 输出 ──
let fail = 0
for (const [n, p] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n); if (!p) fail++ }
console.log('全部通过 ' + (ok.length - fail) + '/' + ok.length)
process.exit(fail ? 1 : 0)