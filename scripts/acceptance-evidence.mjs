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
const appLog = lines(join('logs', 'app.jsonl'))
const NEG = new Set(['难过', '生气', '焦虑', '疲惫'])
const negReal = realEmp.filter((e) => NEG.has(String(e.emotion)))
// 情绪日志通道（1.9.247 起 moodv2.note 会记一条 mood.note，neg>0 表示负面情绪真的动了）
const moodNotes = appLog.filter((r) => r.kind === 'mood.note')
const moodNeg = moodNotes.filter((r) => Number(r.neg) > 0)
const moodPass = negReal.length >= 3 || moodNeg.length >= 3

// ── 情绪层健康度：mood 模型调用成功率 ──
const modelCalls = appLog.filter((r) => r.kind === 'model.call')
const moodCalls = modelCalls.filter((r) => r.modelKind === 'mood')
const moodOk = moodCalls.filter((r) => r.ok === true).length
const moodRate = moodCalls.length ? Math.round((moodOk / moodCalls.length) * 100) : null

// ── 运行日志里共情有没有被记下来（新证据通道） ──
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
console.log('  情绪日志里负面变化：' + moodNeg.length + ' 次（kind=mood.note, neg>0）')
console.log('  七情模型调用：' + moodCalls.length + ' 次，成功 ' + moodOk + (moodRate === null ? '' : '（' + moodRate + '%）'))
console.log('  验收口径：至少 3 次真实被怼/难受并记进 docs')
console.log('')
console.log('[日志通道] 共情 ' + empathyLogged.length + ' 条 / 情绪变化 ' + moodNotes.length + ' 条')

// ── 为什么没触发（只读诊断：今天的真实群里，有几句够得上弱信号） ──
try {
  const { readdirSync } = await import('node:fs')
  const { detect } = await import('../lib/empathy.js')
  const today = new Date().toISOString().slice(0, 10)
  let total = 0, weakHits = 0, strongHits = 0
  for (const d of readdirSync(join(STORE_DIR, 'events'))) {
    if (!d.startsWith('g_')) continue
    let f = ''
    try { f = readFileSync(join(STORE_DIR, 'events', d, today + '.jsonl'), 'utf8') } catch { continue }
    for (const line of f.split('\n')) {
      if (!line.trim()) continue
      let e
      try { e = JSON.parse(line) } catch { continue }
      if (e.kind !== 'talk' || e.origin !== 'inbound') continue
      total++
      const em = detect(String(e.text || ''))
      if (!em) continue
      if (em.weak) weakHits++
      else strongHits++
    }
  }
  console.log('')
  console.log('[今天的真实对话] 入站 ' + total + ' 条，强情绪 ' + strongHits + ' 条，弱信号 ' + weakHits + ' 条')
  console.log('  说明：弱信号只在对方 bond≥2 时才算数；如果这里弱信号长期为 0，是群里没那种话')
  const skips = appLog.filter((r) => r.kind === 'empathy.skip')
  const byWhy = {}
  for (const s of skips) byWhy[s.why || '?'] = (byWhy[s.why || '?'] || 0) + 1
  console.log('  听出情绪但没记：' + skips.length + ' 次 ' + JSON.stringify(byWhy))
} catch { /* 诊断失败不影响主报告 */ }

const allPass = empathyPass && personaPass && moodPass
console.log('')
console.log(allPass ? '三项全部达标。' : '还没全达标——差的是真实样本，不是代码。')
if (strict && !allPass) process.exit(1)
