/**
 * P10 能力运行时测试：策略闸、超时、失败码、审计、默认注册
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-p10-'))
delete process.env.QQBOT_REFINE_HOME
const url = (p) => new URL(p, import.meta.url).href
const C = await import(url('../lib/caprun.js'))
const P = await import(url('../lib/policy.js'))
const { ensureStore } = await import(url('../lib/config.js'))
const { ensureDirs } = await import(url('../lib/store.js'))
await import(url('../lib/caps-default.js'))
ensureStore(); ensureDirs(); P.ensurePolicy()

const ok = []
const T = (n, p, d) => ok.push([n, !!p, d])

// 默认能力已注册
{
  const ids = C.listCapabilities().map((x) => x.id)
  T('生图/语音/搜索已注册', ['image.generate', 'voice.speak', 'link.search'].every((x) => ids.includes(x)), ids)
}

// 未知能力
{
  const r = await C.runCapability('nope.nope')
  T('未知能力给明确码', r.ok === false && r.code === 'unknown_capability', r)
}

// 成功 + 审计
{
  C.registerCapability({ id: 'test.echo', provider: 'test', policyKey: 'tool.read', timeoutMs: 1000, run: async ({ params }) => ({ ok: true, data: params.x }) })
  const r = await C.runCapability('test.echo', { x: 42 })
  T('正常执行', r.ok === true && r.data === 42 && r.code === 'ok', r)
  T('耗时被记录', Number.isFinite(r.ms) && r.ms >= 0)
}

// 策略：off / human
{
  P.setConfirmCode('1234')
  const req = P.requestChange({ actions: { 'image.generate': 'off' } }, { by: 'owner' })
  P.applyChange(req.id, '1234', { by: 'owner' })
  const off = await C.runCapability('image.generate', { prompt: 'x' })
  T('策略 off 会拦', off.ok === false && off.code === 'disabled', off)
  const req2 = P.requestChange({ actions: { 'voice.speak': 'human' } }, { by: 'owner' })
  P.applyChange(req2.id, '1234', { by: 'owner' })
  const hu = await C.runCapability('voice.speak', { vc: {}, text: 'x' })
  T('策略 human 会拦', hu.ok === false && hu.code === 'human_only', hu)
}

// 失败与超时
{
  C.registerCapability({ id: 'test.fail', provider: 'test', policyKey: 'tool.read', timeoutMs: 1000, run: async () => ({ ok: false, code: 'boom', error: '炸了' }) })
  const r = await C.runCapability('test.fail')
  T('失败码原样透出', r.ok === false && r.code === 'boom' && r.error === '炸了', r)
  C.registerCapability({ id: 'test.slow', provider: 'test', policyKey: 'tool.read', timeoutMs: 50, run: () => new Promise(() => {}) })
  const s = await C.runCapability('test.slow')
  T('超时给 timeout 码', s.ok === false && s.code === 'timeout', s)
}

console.log('=== P10 能力运行时测试 ===')
let fail = 0
for (const [n, p, d] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d))); if (!p) fail++ }
console.log(fail ? `失败 ${fail}` : '全部通过')
try { rmSync(process.env.DSH_HOME, { recursive: true, force: true }) } catch {}
process.exitCode = fail ? 1 : 0
