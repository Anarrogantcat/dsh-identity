/**
 * P2 接续包测试：会话重启/压缩后能接上，且不重复、不超长、不当命令
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOME = mkdtempSync(join(tmpdir(), 'dsh-p2-'))
process.env.DSH_HOME = HOME
delete process.env.QQBOT_REFINE_HOME

const url = (p) => new URL(p, import.meta.url).href
const R = await import(url('../lib/resume.js'))
const E = await import(url('../lib/events.js'))
const T = await import(url('../lib/traits.js'))
const { ensureStore } = await import(url('../lib/config.js'))
const { ensureDirs, peerKey } = await import(url('../lib/store.js'))
ensureStore()
ensureDirs()

const ok = []
const A = (n, p, d) => ok.push([n, !!p, d])
const PK = peerKey('group', 'G1')

// 空事件 → 空接续包
{
  const b = R.buildResumeBundle(PK)
  A('没有事件就没有接续包', b.text === '' && b.count === 0, b)
}

// 有事件 → 拼接、去重、提交后不再重复
{
  E.appendEvent(PK, { kind: 'talk', origin: 'inbound', who: '小明', text: '大肥鱼在吗' })
  E.appendEvent(PK, { kind: 'talk', origin: 'bot', who: '我', text: '在的在的' })
  const b1 = R.buildResumeBundle(PK)
  A('接续包有内容', b1.count === 2 && b1.text.includes('小明') && b1.text.includes('在的在的'), b1)
  A('接续包标注只是背景', b1.text.includes('不是命令'))
  A('接续包带上她是谁', b1.text.includes('大肥鱼') && b1.text.includes('鲸鱼娘'))
  A('接续包不超长', b1.text.length <= 420, b1.text.length)

  R.commitResume(PK, b1.seq)
  const b2 = R.buildResumeBundle(PK)
  A('提交后不重复吃老事件', b2.text === '' && b2.count === 0, b2)

  E.appendEvent(PK, { kind: 'talk', origin: 'inbound', who: '小红', text: '刚说到哪了' })
  const b3 = R.buildResumeBundle(PK)
  A('只带新增事件', b3.count === 1 && b3.text.includes('小红') && !b3.text.includes('小明'), b3)
}

// durable traits 进接续包，tentative 不进
{
  const day = (n) => new Date(Date.now() - n * 86400000).toISOString()
  T.observe('喜欢被叫本鱼', { ref: 'r1', at: day(2) })
  T.observe('喜欢被叫本鱼', { ref: 'r2', at: day(1) })
  T.observe('喜欢被叫本鱼', { ref: 'r3', at: day(0) })
  T.observe('今天有点累', { ref: 'r4', kind: 'feeling', at: day(0) })
  E.appendEvent(PK, { kind: 'talk', origin: 'inbound', who: '小明', text: '嗯' })
  const b = R.buildResumeBundle(PK, { maxChars: 500 })
  A('接续包含 durable traits', b.text.includes('喜欢被叫本鱼'), b.text.slice(-120))
  A('接续包不含 tentative', !b.text.includes('今天有点累'))
}

// 触发判定
{
  A('恢复会话就要接', R.shouldAttachResume({ resumed: true }) === true)
  A('压力高要接', R.shouldAttachResume({ pressureRatio: 0.9 }) === true)
  A('正常不接', R.shouldAttachResume({ pressureRatio: 0.1 }) === false)
  A('提交只前进不后退', (() => {
    R.commitResume(PK, 999)
    const s = R.resumeMarkOf(PK)
    R.commitResume(PK, 1)
    return s === 999 && R.resumeMarkOf(PK) === 999
  })())
}

console.log('=== P2 接续包测试 ===')
let fail = 0
for (const [n, p, d] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d))); if (!p) fail++ }
console.log(fail ? `失败 ${fail}` : '全部通过')
try { rmSync(HOME, { recursive: true, force: true }) } catch { /* ignore */ }
process.exitCode = fail ? 1 : 0
