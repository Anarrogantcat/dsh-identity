/**
 * 自我快照：写不出「跟上次比改了什么」就不许存。
 * 旧毛病：三条快照隔 12 小时，summary 一字不差，只有心情标签在换。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-selfhist-'))
delete process.env.QQBOT_REFINE_HOME
const url = (p) => new URL(p, import.meta.url).href
const { ensureStore } = await import(url('../lib/config.js'))
const { ensureDirs, dirs } = await import(url('../lib/store.js'))
const { buildSelfModel } = await import(url('../lib/selfmodel.js'))
ensureStore(); ensureDirs()

const p = join(dirs.root, 'selfmodel-history.jsonl')
const lines = () => (existsSync(p) ? readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])
const setLastAt = (msAgo, patch = {}) => {
  const arr = lines()
  if (!arr.length) return
  arr[arr.length - 1] = { ...arr[arr.length - 1], at: new Date(Date.now() - msAgo).toISOString(), ...patch }
  writeFileSync(p, arr.map((x) => JSON.stringify(x)).join('\n') + '\n')
}

const ok = []
const T = (n, p, d) => ok.push([n, !!p, d])

// 第一次：没有历史，写一条基线
buildSelfModel()
T('第一次写一条基线', lines().length === 1, lines())

// 六小时内不再写
buildSelfModel()
T('六小时内不重复写', lines().length === 1, lines().length)

// 把基线挪到 7 小时前，并把 substance 改掉 → 应该追加「跟上次比」
setLastAt(7 * 3600000, { substance: 'OLD-STATE' })
buildSelfModel()
const arr2 = lines()
T('过了冷却且实质变了 → 写一条', arr2.length === 2, arr2.length)
T('新快照写明跟上次比变了什么', /^跟上次比：/.test(String(arr2[1]?.summary)), arr2[1]?.summary)

// 再等 7 小时，但 substance 没变 → 不写（这正是旧版的复读）
setLastAt(7 * 3600000)
buildSelfModel()
const arr3 = lines()
T('实质没变就不许存（防复读）', arr3.length === 2, arr3.map((x) => x.summary))

// 新快照带 substance，下次能比
T('快照存了 substance 供下次比较', typeof arr3[1]?.substance === 'string' && arr3[1].substance.length > 0, arr3[1]?.substance)

console.log('=== 自我快照防复读测试 ===')
let fail = 0
for (const [n, p2, d] of ok) { console.log((p2 ? 'OK  ' : 'FAIL ') + n + (p2 ? '' : '   ' + JSON.stringify(d))); if (!p2) fail++ }
console.log(fail ? '失败 ' + fail : '全部通过')
try { rmSync(process.env.DSH_HOME, { recursive: true, force: true }) } catch {}
process.exit(fail ? 1 : 0)
