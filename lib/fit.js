/**
 * 话题适配度：判断一条群消息「适不适合她接」
 * 纯本地启发式（0 token）：问句/求助/话题词加分，接龙/贴图/@别人/私事减分
 * 可配话题词与负面词；阈值可调；被叫小名或 @ 时跳过判定（那是明确找她）
 */

const ASK = /[?？]|吗[。.!！\s]*$|呢[。.!！\s]*$|怎么|为什么|能不能|可不可以|是不是|有没有|在哪|如何|求|帮我|谁懂|有人知道|请问/i
const HELP = /帮我|求|谁懂|有人知道|请教|求助|怎么办|搞不定|报错|崩了|坏了|怎么弄/i
const SHORT = /^[\s\S]{0,5}$/
const EMOJI_ONLY = /^[\s\p{Emoji_Presentation}\p{Extended_Pictographic}]+$/u

export const DEFAULT_TOPICS = ['代码', '报错', '配置', '教程', '电脑', '软件', '游戏', 'B站', '视频', '模型', 'AI', '学习', '作业', '翻译', '下载', '文件', '插件', '系统', '网络', '图片', '表情包', '剪辑', '手机']
export const DEFAULT_NEGATIVE = ['红包', '转账', '借钱', '私聊', '面基', '约见', '开黑', '上号', '@全体', '全体成员', '撤回了一条', '拍了拍']

/**
 * @returns {{score:number, reasons:string[], pass:boolean}}
 */
export function scoreFit(text, cfg, opts = {}) {
  const p = cfg?.frequency ?? {}
  const s = String(text ?? '').trim()
  const reasons = []
  let score = 0

  if (!s) return { score: 0, reasons: ['empty'], pass: false }

  if (ASK.test(s)) { score += 0.35; reasons.push('问句') }
  if (HELP.test(s)) { score += 0.25; reasons.push('求助') }

  const topics = (p.fitTopics && p.fitTopics.length ? p.fitTopics : DEFAULT_TOPICS)
  if (topics.some((t) => t && s.includes(t))) { score += 0.25; reasons.push('话题相关') }

  if (SHORT.test(s)) { score -= 0.25; reasons.push('太短(接龙)') }
  if (EMOJI_ONLY.test(s)) { score -= 0.3; reasons.push('纯表情') }
  if (s.length > 60) { score += 0.05; reasons.push('长句(认真在说)') }

  // @ 别人（不是她）
  const otherMention = /<@!?(\d{5,})>/.exec(s)
  if (otherMention) { score -= 0.4; reasons.push('@别人') }

  const neg = (p.fitNegative && p.fitNegative.length ? p.fitNegative : DEFAULT_NEGATIVE)
  const negHit = neg.find((w) => w && s.includes(w))
  if (negHit) { score -= 0.35; reasons.push(`负面:${negHit}`) }

  // 连续同一人刷屏（由调用方传入最近消息计数）
  if (opts.sameSenderBurst && opts.sameSenderBurst >= 3) { score -= 0.2; reasons.push('刷屏') }
  if (opts.hasImage && s.length < 10) { score -= 0.2; reasons.push('图片无文') }

  const pass = score >= (p.fitThreshold ?? 0.35)
  return { score: Math.round(score * 100) / 100, reasons, pass }
}
