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
  if (/(太正经|太官方|太严肃|太客气|太端着|像机器人|像 ?AI|像qq机器人|像QQ机器人)/.test(t)) return '说话别太正经，随意一点、口语一点'
  if (/(说人话|别客服腔|别官方)/.test(t)) return '说人话，别客服腔'
  if (/(多看|先看|翻).{0,8}(上下文|聊天记录|聊天|记录)/.test(t)) return '接话前先多看几条聊天记录，再回答'
  if (/(理解错|没看懂|答错|不是这个|说错|接错|看上下文)/.test(t)) return '被指出理解错时，先看上下文再答，别硬接'
  return ''
}

/** 新反馈会推翻哪条旧习惯（只处理语义明确的对立） */
export function oppositeFeedback(fb) {
  const s = String(fb || '')
  if (/多说一点|别总一两句/.test(s)) return '别写长文，说重点、短一点'
  if (/别写长文|说重点|短一点/.test(s)) return '可以多说一点，别总一两句'
  return ''
}
