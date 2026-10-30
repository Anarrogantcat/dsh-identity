/**
 * 联网搜索：解析 DDG 结果（标题+域名+摘要）、空结果换简化词重试、结果排版与字符上限
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOME = mkdtempSync(join(tmpdir(), 'dsh-search-'))
process.env.DSH_HOME = HOME
delete process.env.QQBOT_REFINE_HOME

const base = new URL('../', import.meta.url).href
const { ensureStore } = await import(base + 'lib/config.js')
const { ensureDirs } = await import(base + 'lib/store.js')
ensureStore(); ensureDirs()
const D = await import(base + 'lib/draw.js')
const T = await import(base + 'lib/toolgate.js')

const ok = []
const A = (n, p, d) => ok.push([n, !!p, d])

const HTML = `
<div class="result results_links">
  <h2 class="result__title"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.cngold.org%2F&amp;rut=abc">今日金价_金投网</a></h2>
  <a class="result__snippet" href="x">国内今日黄金价格数据来源<strong>上海黄金交易所</strong>，单位：1克黄金兑换人民币。</a>
</div>
<div class="result results_links">
  <h2 class="result__title"><a class="result__a" href="https://example.com/jin">黄金价格走势图</a></h2>
  <a class="result__snippet">实时行情，每 10 秒更新</a>
</div>
`

// 解析：标题、真实链接、去标签的摘要
{
  const items = D.parseDdg(HTML, 4)
  A('解析出两条', items.length === 2, items)
  A('标题去标签', items[0].title === '今日金价_金投网', items[0].title)
  A('跳转链接还原成真实域名', items[0].url === 'https://www.cngold.org/', items[0].url)
  A('摘要去掉 HTML 标签', items[0].snippet.includes('上海黄金交易所') && !items[0].snippet.includes('<strong>'), items[0].snippet)
  A('普通链接原样保留', items[1].url === 'https://example.com/jin', items[1].url)
  A('limit 生效', D.parseDdg(HTML, 1).length === 1)
  A('空 HTML 不炸', Array.isArray(D.parseDdg('', 3)) && D.parseDdg('', 3).length === 0)
}

// searchResults：注入 fetch，不联网
{
  const got = await D.searchResults('金价', 2, { fetchImpl: async () => ({ ok: true, text: async () => HTML }) })
  A('searchResults 返回结构化结果', got.length === 2 && got[0].title.includes('金投网'), got)
  const bad = await D.searchResults('金价', 2, { fetchImpl: async () => ({ ok: false }) })
  A('HTTP 失败返回空数组', Array.isArray(bad) && bad.length === 0)
  const boom = await D.searchResults('金价', 2, { fetchImpl: async () => { throw new Error('net') } })
  A('异常不抛，返回空', Array.isArray(boom) && boom.length === 0)
  const empty = await D.searchResults('', 2, { fetchImpl: async () => ({ ok: true, text: async () => HTML }) })
  A('空查询不发请求', Array.isArray(empty) && empty.length === 0)
}

// 老接口 searchSnippets 只给摘要文本，行为保持
{
  const snips = await D.searchSnippets('金价', 2, { fetchImpl: async () => ({ ok: true, text: async () => HTML }) })
  A('searchSnippets 仍返回字符串数组', Array.isArray(snips) && snips.every((s) => typeof s === 'string'), snips)
}

// 简化词
{
  A('去掉今天/多少', T.simplifyQuery('今天金价多少') === '金价', T.simplifyQuery('今天金价多少'))
  A('去掉口语问法', T.simplifyQuery('现在比分怎么样？') === '比分', T.simplifyQuery('现在比分怎么样？'))
  A('本来就短就不动', T.simplifyQuery('金价') === '金价', T.simplifyQuery('金价'))
}

// 排版：标题（域名）：摘要，且有字符上限
{
  const items = [
    { title: '今日金价_金投网', url: 'https://www.cngold.org/x', snippet: '数据来源上海黄金交易所' },
    { title: '黄金价格走势图', url: 'https://example.com/jin', snippet: '' },
  ]
  const txt = T.renderSearchItems(items, 600)
  A('带域名', txt.includes('（cngold.org）'), txt)
  A('www 去掉', !txt.includes('www.cngold.org'), txt)
  A('没有摘要就只写标题', /- 黄金价格走势图（example.com）$/.test(txt), txt)
  const long = Array.from({ length: 20 }, (_, i) => ({ title: '标题' + i, url: 'https://a.com/' + i, snippet: 'x'.repeat(100) }))
  A('字符上限生效', T.renderSearchItems(long, 300).length <= 320, T.renderSearchItems(long, 300).length)
  A('空结果返回空串', T.renderSearchItems([], 600) === '')
}

// 空结果换简化词重试一次
{
  const calls = []
  const fetchImpl = async (u) => {
    calls.push(decodeURIComponent(String(u)))
    const q = decodeURIComponent(String(u).split('q=')[1] || '').trim()
    if (q === '金价') return { ok: true, text: async () => HTML }
    return { ok: true, text: async () => '<div>没有结果</div>' }
  }
  const got = await T.lookupWeb('今天金价多少', 3, { fetchImpl })
  A('原词空 → 换简化词再试', got.length === 2 && calls.length === 2, { n: got.length, calls })
  A('重试用的是简化后的词', calls[1].includes('q=金价'), calls[1])
}
{
  const calls = []
  const fetchImpl = async (u) => { calls.push(String(u)); return { ok: true, text: async () => HTML } }
  const got = await T.lookupWeb('金价', 3, { fetchImpl })
  A('第一次就有结果就不再重试', got.length === 2 && calls.length === 1, calls.length)
}

console.log('=== 联网搜索（解析/兜底/排版）测试 ===')
let fail = 0
for (const [n, p, d] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d))); if (!p) fail++ }
console.log(fail ? `失败 ${fail}` : '全部通过')
try { rmSync(HOME, { recursive: true, force: true }) } catch { /* ignore */ }
process.exitCode = fail ? 1 : 0
