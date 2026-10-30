/**
 * 热梗抓取：写进知识库、同日覆盖、过期清理、失败不抛。
 */
import { mkdtempSync, readFileSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-memes-'))
delete process.env.QQBOT_REFINE_HOME

const url = (p) => new URL(p, import.meta.url).href
const { ensureStore } = await import(url('../lib/config.js'))
const { ensureDirs } = await import(url('../lib/store.js'))
const M = await import(url('../lib/memes.js'))
ensureStore(); ensureDirs()

const ok = []
const T = (n, p, d) => ok.push([n, !!p, d])

const stub = (titles) => async () => ({
  ok: true,
  json: async () => ({ data: { band_list: titles.map((t, i) => ({ word: t, category: '综艺', rank: i + 1 })) } }),
})

const r1 = await M.refreshMemes({ fetchImpl: stub([' 第一条梗\n换行 ', '第二条']), now: Date.now() })
T('抓取成功', r1.ok && r1.count === 2, r1)
const text1 = readFileSync(M.MEMES_FILE, 'utf8')
T('标题清洗换行', text1.includes('第一条梗 换行'), text1)
T('带微博搜索链接', text1.includes('s.weibo.com/weibo?q='), text1)
T('同一天只有一段', (text1.match(/^## /gm) || []).length === 1, text1)

// 时政/民生类要被跳过
const pol = await M.fetchHot({ fetchImpl: async () => ({
  ok: true,
  json: async () => ({ data: { band_list: [
    { word: '某时政新闻', category: '国内时政' },
    { word: '某艺人新歌', category: '艺人' },
    { word: '社会新闻一条', category: '民生新闻' },
  ] } }),
}) })
T('时政民生被过滤', pol.length === 1 && pol[0].title === '某艺人新歌', pol)

// 同一天再抓一次：覆盖，不叠加
await M.refreshMemes({ fetchImpl: stub(['新的一条']), now: Date.now() })
const text2 = readFileSync(M.MEMES_FILE, 'utf8')
T('同日覆盖不叠加', (text2.match(/^## /gm) || []).length === 1 && text2.includes('新的一条') && !text2.includes('第二条'), text2)

// 过期段清理
const old = '## 2000-01-01\n- 上古梗\n'
const merged = M.mergeSections(old, [{ title: '今天的', url: 'https://s.weibo.com/x' }], { day: M.dayOf(), keepDays: 14 })
T('过期段被清掉', !merged.includes('上古梗') && merged.includes('今天的'), merged)

// 接口坏掉不抛
const bad = await M.fetchHot({ fetchImpl: async () => ({ ok: false, json: async () => ({}) }) })
T('坏接口返回空数组', Array.isArray(bad) && bad.length === 0, bad)

// due：刚写完不算到点；把 mtime 拨旧就算
T('刚抓完不到点', M.memesDue(24) === false)
const past = (Date.now() - 25 * 3600000) / 1000
utimesSync(M.MEMES_FILE, past, past)
T('超过间隔该抓', M.memesDue(24) === true)

console.log('=== 热梗知识库测试 ===')
let fail = 0
for (const [n, p, d] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d))); if (!p) fail++ }
console.log(fail ? '失败 ' + fail : '全部通过')
try { rmSync(process.env.DSH_HOME, { recursive: true, force: true }) } catch {}
process.exit(fail ? 1 : 0)
