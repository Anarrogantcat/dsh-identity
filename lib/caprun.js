/**
 * 能力运行时（L4）：一件具体的事 = provider + 参数 + 成本 + 超时 + 失败码 + 策略键 + 审计。
 *
 * 铁律：
 *   · 能不能做问策略（policyKey），做不做由调用方决定；本模块不读聊天内容
 *   · 统一超时；失败返回结构化 code，不抛给聊天层
 *   · 每次调用都审计（id/ms/ok/code），成本估算也记下来
 *   · 同一能力只实现一次，多入口共用（#画 / 自然语言 / 工具暴露都走这里）
 */
import { audit } from './store.js'
import { decideAction } from './policy.js'

const REG = new Map()

/** 注册能力（也可供测试注入） */
export function registerCapability(entry = {}) {
  const id = String(entry.id ?? '')
  if (!id) throw new Error('能力必须有 id')
  REG.set(id, {
    id,
    provider: String(entry.provider ?? 'local'),
    policyKey: String(entry.policyKey ?? 'tool.read'),
    cost: Number(entry.cost ?? 0) || 0,
    timeoutMs: Math.max(100, Number(entry.timeoutMs ?? 30000) || 30000),
    run: typeof entry.run === 'function' ? entry.run : async () => ({ ok: false, code: 'not_implemented', error: '没有实现' }),
  })
  return id
}

export function listCapabilities() {
  return [...REG.values()].map((c) => ({ id: c.id, provider: c.provider, policyKey: c.policyKey, cost: c.cost, timeoutMs: c.timeoutMs }))
}

/**
 * 跑一个能力。
 * @returns {Promise<{ok:boolean, code:string, data?:any, error?:string, ms:number}>}
 */
export async function runCapability(id, params = {}, ctx = {}) {
  const t0 = Date.now()
  const cap = REG.get(String(id))
  const fail = (code, error) => {
    try { audit('cap.call', { id: String(id), ok: false, code, ms: Date.now() - t0 }) } catch { /* ignore */ }
    return { ok: false, code, error: String(error ?? ''), ms: Date.now() - t0 }
  }
  if (!cap) return fail('unknown_capability', '未知能力：' + id)
  const d = decideAction(cap.policyKey, {}, {})
  if (!d.ok) {
    if (d.human) return fail('human_only', '这个动作只能由人做')
    if (d.needConfirm) return fail('needs_confirm', '需要确认')
    if (d.mode === 'off') return fail('disabled', '能力已关闭（策略）')
    return fail('policy_denied', d.reason ?? '策略拒绝')
  }
  let timer = null
  try {
    const work = Promise.resolve().then(() => cap.run({ ...ctx, cfg: ctx.cfg, params }))
    const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(Object.assign(new Error('执行超时'), { __timeout: true })), cap.timeoutMs) })
    const r = await Promise.race([work, timeout])
    if (!r || r.ok !== true) return fail(String(r?.code ?? 'failed'), r?.error ?? '执行失败')
    try { audit('cap.call', { id: cap.id, ok: true, ms: Date.now() - t0, cost: cap.cost }) } catch { /* ignore */ }
    return { ok: true, code: 'ok', data: r.data ?? r.result ?? null, ms: Date.now() - t0 }
  } catch (err) {
    const code = err?.__timeout ? 'timeout' : 'failed'
    return fail(code, err?.message ?? err)
  } finally {
    if (timer) clearTimeout(timer)
  }
}
