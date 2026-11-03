/**
 * 人优先的保底：注入里必须能看见「关于这个人」的事，不能被分数/断崖全砍掉。
 *
 * 真实数据验出来的毛病（2026-11-03）：池子里有 18 条关于人的记忆，注入只出 0–1 条——
 * 老条目的鲜活度 A 很低，P 过不了 injectFloor，pickInject 直接返回空。
 * 保底规则：只要能过相关度门槛，先把「关于这个人」的补到 min(3, 池里有的) 条。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOME = mkdtempSync(join(tmpdir(), 'dsh-persong-'))
process.env.DSH_HOME = HOME
delete process.env.QQBOT_REFINE_HOME

const url = (p) => new URL(p, import.meta.url).href
const M = await import(url('../lib/memory.js'))
const { ensureStore, clone, DEFAULTS } = await import(url('../lib/config.js'))
const { ensureDirs, peerKey, dirs, writeJson } = await import(url('../lib/store.js'))
ensureStore()
ensureDirs()

const ok = []
const T = (n, p, d) => ok.push([n, !!p, d])
const cfg = clone(DEFAULTS)
const DAY = 86400000
let seq = 0

const old = (text, category, extra = {}) => {
  const at = new Date(Date.now() - 90 * DAY).toISOString()
  seq += 1
  return {
    id: 'p' + seq, text, category, importance: 0.5, emotion: 0, valence: 0,
    at, createdAt: at, activation0: 0.8, activationAnchor: at,
    status: 'active', source: 'group', origin: 'user', confidence: 0.9, pinned: false, hits: 1, ...extra,
  }
}

function cardPersonLines(card) {
  const lines = String(card ?? '').split('\n')
  const a = lines.indexOf('关于这个人：')
  const b = lines.indexOf('最近发生的事：')
  return a >= 0 ? lines.slice(a + 1, b > a ? b : lines.length).filter((l) => l.startsWith('- ')) : []
}

// 一、池里 4 条关于人的老事实 → 注入至少 3 条（分数再低也保底）
{
  const pk = peerKey('group', 'G-PG-1')
  writeJson(join(dirs.memory, `${pk}.json`), {
    items: [
      old('他喜欢先看结论再听解释', 'preference'),
      old('他讨厌被催进度', 'preference'),
      old('他习惯半夜还在写代码', 'fact'),
      old('他养了一只猫叫团子', 'fact'),
      old('群里那天聊到抽卡', 'event'),
      old('后来又说插件版本不对', 'event'),
    ],
    df: {}, n: 6,
  })
  const card = M.memoryCard(pk, cfg)
  const person = cardPersonLines(card)
  T('老事实也能进注入（≥3）', person.length >= 3, { n: person.length, card })
  const known = ['他喜欢先看结论再听解释', '他讨厌被催进度', '他习惯半夜还在写代码', '他养了一只猫叫团子']
  T('带的是关于人的那几条', person.every((l) => known.some((k) => l.includes(k))), person)
}

// 二、池里只有 1 条：就注入 1 条，不硬凑
{
  const pk = peerKey('group', 'G-PG-2')
  writeJson(join(dirs.memory, `${pk}.json`), {
    items: [old('他喜欢先看结论再听解释', 'preference'), old('群里聊到抽卡', 'event')],
    df: {}, n: 2,
  })
  const person = cardPersonLines(M.memoryCard(pk, cfg))
  T('只有一条就注入一条', person.length === 1, person)
}

// 三、已经选进 3 条关于人的就不再塞
{
  const pk = peerKey('group', 'G-PG-3')
  writeJson(join(dirs.memory, `${pk}.json`), {
    items: [
      old('今天群里聊到抽卡', 'event', { importance: 0.95, activation0: 1, activationAnchor: new Date().toISOString() }),
      old('他喜欢先看结论再听解释', 'preference'),
      old('他讨厌被催进度', 'preference'),
      old('他习惯半夜还在写代码', 'fact'),
      old('他养了一只猫叫团子', 'fact'),
    ],
    df: {}, n: 5,
  })
  const card = M.memoryCard(pk, cfg)
  const person = cardPersonLines(card)
  T('保底不会超过 3 条', person.length === 3, person)
}

console.log('=== 记忆注入「人优先」保底 测试 ===')
let fail = 0
for (const [n, p, d] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d))); if (!p) fail++ }
console.log(fail ? `失败 ${fail}` : '全部通过')
try { rmSync(HOME, { recursive: true, force: true }) } catch { /* ignore */ }
process.exitCode = fail ? 1 : 0
