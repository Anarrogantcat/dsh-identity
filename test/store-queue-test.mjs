/**
 * 写队列：同一路径的「读-改-写」要串行，否则先读、await、再写回就是 last-write-wins。
 *
 * 这条来自 dsh-companion 的 memory-store（enqueue + 原子写）。
 * 我们踩过的现场：addMemory 写完，另一个函数拿着旧副本再 save，把刚写的摘要盖掉。
 *
 * 这里守四件事：
 *   1. 走队列的 20 次并发 +1，一次不丢
 *   2. 不走队列的同样写法会丢（证明这层不是摆设）
 *   3. 同步版（updateJsonSync）同一 tick 内天然原子
 *   4. 队列不被单个失败卡死；写盘不留 .tmp 残渣，文件始终是合法 JSON
 */
import { mkdtempSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-queue-'))
delete process.env.QQBOT_REFINE_HOME

const url = (p) => new URL(p, import.meta.url).href
const { ensureStore } = await import(url('../lib/config.js'))
const S = await import(url('../lib/store.js'))
ensureStore()
S.ensureDirs()

const ok = []
const T = (n, p, d) => ok.push([n, !!p, d])
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const PATH = join(S.dirs.root, 'queue.json')

// 一、走队列：20 次并发 +1，一次不丢
{
  S.writeJson(PATH, { n: 0 })
  await Promise.all(Array.from({ length: 20 }, () => S.updateJson(PATH, { n: 0 }, async (db) => {
    const v = db.n
    await sleep(1)          // 故意在读写之间让出事件循环
    db.n = v + 1
    return db
  })))
  T('队列里并发 20 次不丢', S.readJson(PATH, { n: -1 }).n === 20, S.readJson(PATH, { n: -1 }).n)
}

// 二、不走队列：同样的写法会丢（对照，证明这层不是摆设）
{
  S.writeJson(PATH, { n: 0 })
  await Promise.all(Array.from({ length: 20 }, async () => {
    const db = S.readJson(PATH, { n: 0 })
    const v = db.n
    await sleep(1)
    S.writeJson(PATH, { n: v + 1 })
  }))
  const lost = S.readJson(PATH, { n: -1 }).n
  T('不走队列会丢更新', lost < 20, lost)
}

// 三、同步版：同一 tick 内读完就写，天然原子
{
  S.writeJson(PATH, { n: 0 })
  for (let i = 0; i < 20; i++) S.updateJsonSync(PATH, { n: 0 }, (db) => ({ n: db.n + 1 }))
  T('同步版 20 次全生效', S.readJson(PATH, { n: -1 }).n === 20, S.readJson(PATH, { n: -1 }).n)
}

// 四、队列不被单个失败卡死
{
  S.writeJson(PATH, { n: 0 })
  const boom = S.updateJson(PATH, { n: 0 }, () => { throw new Error('boom') }).catch(() => 'caught')
  const after = S.updateJson(PATH, { n: 0 }, (db) => ({ n: db.n + 1 }))
  T('失败被调用方捕获', (await boom) === 'caught')
  await after
  T('失败之后队列还能用', S.readJson(PATH, { n: -1 }).n === 1, S.readJson(PATH, { n: -1 }).n)
}

// 五、写盘不留残渣，读出来是合法 JSON
{
  S.writeJson(PATH, { n: 7, txt: '原子写' })
  const files = readdirSync(S.dirs.root)
  T('没有 .tmp 残渣', files.every((f) => !f.includes('.tmp-')), files)
  T('读回来是合法的', S.readJson(PATH, null)?.txt === '原子写')
}

// 六、mutate 返回 undefined = 只看不写
{
  S.writeJson(PATH, { n: 3 })
  const before = S.readJson(PATH, { n: -1 })
  await S.updateJson(PATH, { n: 0 }, () => undefined)
  T('返回 undefined 不落盘', S.readJson(PATH, { n: -1 }).n === before.n, S.readJson(PATH, { n: -1 }))
}

console.log('=== 写队列（serialize / updateJson）测试 ===')
let fail = 0
for (const [n, p, d] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d))); if (!p) fail++ }
console.log(fail ? `失败 ${fail}` : '全部通过')
try { rmSync(process.env.DSH_HOME, { recursive: true, force: true }) } catch { /* ignore */ }
process.exitCode = fail ? 1 : 0
