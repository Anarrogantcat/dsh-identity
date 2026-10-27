/**
 * 群聊上下文窗口：默认少给（省钱），只在「可能是接话」的时候多给
 *
 * 依据：短句（不 / 嗯 / 这 / 所以）离开上下文就没意义，这时把窗口翻倍；
 * 正常句子自带信息量，4 条足够。上限仍是 30，防跑飞。
 */
const SHORT_RE = /^(不|嗯|哦|啊|对|是|这|那|所以|然后|但是|可(ei|是)|为啥|为什么|咋|怎么)[\s，。！？!?~～]*$/
const START_RE = /^(不|嗯|哦|啊|这|那|所以|然后|但是|但是|可|可是|那如果|话说)/

export function contextLinesFor(baseLines, content) {
  const base = Math.max(0, Math.min(30, Number(baseLines) || 0))
  const s = String(content ?? '').trim()
  if (!base) return 0
  const short = s.length <= 8
  const dangling = SHORT_RE.test(s) || (s.length <= 14 && START_RE.test(s))
  if (!short && !dangling) return base
  return Math.min(30, base * 2)
}
