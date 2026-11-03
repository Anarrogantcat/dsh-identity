// 主要目标验收证据：共情 / 人格 / 七情 的真实样本够不够
//
// 用法：node scripts/acceptance-evidence.mjs [--strict]
//   --strict：有未达标项时退出码 1（给 CI / 发版前用）
// 只读，不改任何数据。
import { join } from 'node:path'
import { readFileSync, existsSync } from 'node:fs'
import { STORE_DIR } from '../lib/config.js'

const strict = process.argv.includes('--strict')
const p = (f) => join(STORE_DIR, f)

function lines(f) {
  try { return readFileSync(p(f), 'utf8').trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean) } catch { return [] }
}

// empathy.jsonl 里的 peer 是 QQ 群号（纯数字）或 g_/u_ 前缀；夹具用的是 'p'
const isRealPeer = (peer) => /^(\d{5,}|g_|u_)/.test(String(peer || ''))

// ── 共情 ──
const emps = lines('empathy.jsonl')
const realEmp = emps.filter((e) => isRealPeer(e.peer))
const weakEmp = realEmp.filter((e) => e.weak === true)
const empathyPass = realEmp.length >= 1 && weakEmp.length >= 1

// ── 人格 ──
let items = []
try {
  const t = JSON.parse(readFileSync(p('traits.json'), 'utf8'))
  items = Object.values(t.items || {})
} catch { items = [] }
const durable = items.filter((x) => x.status === 'durable')
const tentative = items.filter((x) => x.status === 'tentative')
const stale = items.filter((x) => x.stale === true)
const personaPass = durable.length >= 10

// ── 七情：真实负面情绪样本（被怼/难受） ──
const NEG = new Set(['难过', '生气', '焦虑', '疲惫'])
const negReal = realEmp.filter((e) => NEG.has(String(e.emotion)))
const moodPass = negReal.length >= 3

// ── 运行日志里共情有没有被记下来（新证据通道） ──
const appLog = lines(join('logs', 'app.jsonl'))
const empathyLogged = appLog.filter((r) => r.kind === 'empathy.record')

function mark(ok) { return ok ? '✅ 达标' : '⏳ 还差' }
console.log('=== 主要目标验收证据（只读） ===')
console.log('数据目录：' + STORE_DIR)
console.log('')
console.log('[共情] ' + mark(empathyPass))
console.log('  真实 peer 记录：' + realEmp.length + ' 条（其中弱信号 ' + weakEmp.length + ' 条）')
console.log('  验收口径：≥1 条真实记录且 ≥1 条 weak:true')
console.log('')
console.log('[人格] ' + mark(personaPass))
console.log('  durable ' + durable.length + ' / tentative ' + tentative.length + ' / 待复核(stale) ' + stale.length)
console.log('  验收口径：durable ≥ 10 且无空壳，靠真实聊天攒')
console.log('')
console.log('[七情] ' + mark(moodPass))
console.log('  真实负面情绪记录：' + negReal.length + ' 条（难过/生气/焦虑/疲惫）')
console.log('  验收口径：至少 3 次真实被怼/难受并记进 docs')
console.log('')
console.log('[日志通道] 共情已进运行日志：' + empathyLogged.length + ' 条（kind=empathy.record）')

const allPass = empathyPass && personaPass && moodPass
console.log('')
console.log(allPass ? '三项全部达标。' : '还没全达标——差的是真实样本，不是代码。')
if (strict && !allPass) process.exit(1)
