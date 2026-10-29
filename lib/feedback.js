/**
 * 从群友的话里学习：夸、纠、提醒 → 一条可观察的「她该怎么说话」候选。
 * 只做规则映射，不调模型；是否留下由 traits 证据规则决定。
 */
export function feedbackTraitOf(text) {
  const t = String(text || '').trim()
  if (!t || t.length > 120) return ''
  if (/别(这么|太)?(凶|冲|冷|敷衍|阴阳)/.test(t)) return '别对群友太凶、太冲'
  if (/(太短|多说点|多讲点|别这么短|就一句)/.test(t)) return '可以多说一点，别总一两句'
  if (/(好可爱|可爱|喜欢你|好萌|好耶)/.test(t)) return '被夸可爱会开心，但别飘'
  if (/(太啰嗦|太长|别写作文|说重点)/.test(t)) return '别写长文，说重点、短一点'
  if (/(别老道歉|不用道歉|道什么歉)/.test(t)) return '别动不动道歉'
  if (/(说人话|别客服腔|别官方)/.test(t)) return '说人话，别客服腔'
  return ''
}
