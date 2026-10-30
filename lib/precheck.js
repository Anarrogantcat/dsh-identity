/** 安全前置：只做不可谈判的拦截，不参与“想不想说” */
export function safetyPrecheck({ otherMention = false, self = false, command = false, mediaDeny = false } = {}) {
  if (command) return { block: true, source: 'safety:command', reason: '命令由命令层处理' }
  if (self) return { block: true, source: 'safety:self', reason: '自己的消息不回' }
  if (otherMention) return { block: true, source: 'safety:otherMention', reason: '@别人，不接' }
  if (mediaDeny) return { block: true, source: 'safety:media', reason: '媒体闸拒绝' }
  return { block: false, source: 'ok', reason: '' }
}
