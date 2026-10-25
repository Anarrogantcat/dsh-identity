/**
 * 「是不是在跟她说话」判定（directedness）
 * 纯本地、0 token。区分三类：
 *   ① 明确找她：@她 / 叫小名 / 「机器人/助手/AI」呼号 / 引用她的消息
 *   ② 像在问她：「你…吗/你能…/你帮我」+ 她刚说过话
 *   ③ 明显不是：@别人 / 「你俩」/ 回复别人的话 / 第三人称转述
 */

const CALL = /^(?:机器人|助手|ai|bot|小助手)[\s，,。!！?？]*/i
const ROBOT_WORD = /机器人|小助手|\bAI\b|\bbot\b/i
const SECOND_PERSON = /你(?!们俩)/

/** 明显不是对她说的模式 */
const NOT_TO_BOT = [
  /你俩|你们俩|你和他|她俩/,
  /^(?:回复|转发)/,
  /(?:他说|她说|刚说|楼下说|楼上说)/,
]

/**
 * @param {string} text 消息正文
 * @param {{aliases?:string[], botJustSpokeSec?:number, repliedToBot?:boolean, hasOtherMention?:boolean}} ctx
 * @returns {{score:number, reasons:string[], direct:boolean}}
 */
export function directedness(text, ctx = {}) {
  const s = String(text ?? '').trim()
  const reasons = []
  let score = 0
  if (!s) return { score: 0, reasons: ['empty'], direct: false }

  const aliases = ctx.aliases ?? []
  if (aliases.some((a) => a && s.includes(a))) { score += 0.6; reasons.push('叫小名') }
  if (CALL.test(s)) { score += 0.35; reasons.push('呼号') }
  if (ROBOT_WORD.test(s) && !aliases.some((a) => a && s.includes(a))) { score += 0.3; reasons.push('提到机器人') }
  if (ctx.repliedToBot) { score += 0.5; reasons.push('引用她的消息') }

  const questionish = /[?？]|吗[。.!！\s]*$|呢[。.!！\s]*$|帮我|能不能|可不可以|你.*(?:啥|什么|怎么|哪)/i.test(s)
  if (SECOND_PERSON.test(s) && questionish) {
    score += 0.25
    reasons.push('在问你')
    if ((ctx.botJustSpokeSec ?? 999) <= 120) { score += 0.2; reasons.push('她刚说过') }
  }

  if (ctx.hasOtherMention) { score -= 0.5; reasons.push('@别人') }
  for (const re of NOT_TO_BOT) {
    if (re.test(s)) { score -= 0.4; reasons.push('明显对别人'); break }
  }

  score = Math.max(0, Math.min(1, score))
  return { score: Math.round(score * 100) / 100, reasons, direct: score >= 0.5 }
}
