/**
 * P13 登录桥 + B站台账测试
 */
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-p13-'))
delete process.env.QQBOT_REFINE_HOME
const HOME = process.env.DSH_HOME
const url = (p) => new URL(p, import.meta.url).href
const B = await import(url('../lib/bili.js'))
const BR = await import(url('../lib/bridge.js'))
const { ensureStore } = await import(url('../lib/config.js'))
const { ensureDirs, dirs } = await import(url('../lib/store.js'))
ensureStore(); ensureDirs()
const ok = []
const T = (n, p, d) => ok.push([n, !!p, d])

// B站动态去重台账
{
  const link = 'https://t.bilibili.com/123'
  T('第一次没看过', B.seenDynamic(link) === false)
  const m = B.markDynamic(link)
  T('标记成功', m.ok === true)
  T('标记后算看过', B.seenDynamic(link) === true)
  T('重复标记不重复台账', B.markDynamic(link).dup === true)
  T('空链接不记', B.markDynamic('').ok === false)
}

// 登录桥：专用资料夹、只认 http(s)、状态探测
{
  const pd = BR.profileDir()
  T('资料夹建好且在数据目录', existsSync(pd) && pd.includes('browser-profile'), pd)
  T('非法地址拒绝', BR.openLogin('file:///C:/secret').ok === false)
  const st = await BR.bridgeStatus({ timeoutMs: 300 })
  T('状态探测不抛并返回结构', typeof st.ok === 'boolean' && typeof st.up === 'boolean', st)
}

console.log('=== P13 登录桥/B站台账测试 ===')
let fail = 0
for (const [n, p, d] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d))); if (!p) fail++ }
console.log(fail ? `失败 ${fail}` : '全部通过')
try { rmSync(HOME, { recursive: true, force: true }) } catch {}
process.exitCode = fail ? 1 : 0
