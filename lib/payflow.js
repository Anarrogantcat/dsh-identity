/**
 * 支付流（L3/L4-b）：花钱这件事的「提议 → 确认 → 台账」薄封装。
 *
 * 铁律：模型永远不能自己付钱；这里只接受人给的参数，确认码只在人手里。
 *   · 创建订单：金额/收款方/事由/订单号（幂等键）；限额与白名单由 gateway 校验
 *   · 确认执行：只有 owner + 正确确认码 + 未过期 + 未重放才执行
 *   · 台账：gateway 写入；本模块只做薄封装与统一返回码
 */
import { createRequest, confirmRequest, paymentSummary, listRequests } from './gateway.js'
import { sha } from './store.js'

/** 一条新支付请求（返回 requestId / 到期时间） */
export function requestPayment({ amount, payee, purpose = '', orderId = '' }, meta = {}) {
  const ord = String(orderId || ('ord_' + sha(`${meta.by ?? ''}|${amount}|${payee}|${Date.now()}`, 10)))
  return createRequest({ amount, payee, purpose, orderId: ord }, meta)
}

/** 人拿确认码执行；失败原因结构化返回 */
export function confirmPayment(requestId, code, meta = {}) {
  return confirmRequest(requestId, code, { ...meta, by: 'owner' })
}

export function paySummary() {
  try { return paymentSummary() } catch (err) { return { ok: false, error: String(err?.message ?? err) } }
}

export function payRequests() {
  try { return listRequests() } catch { return [] }
}
