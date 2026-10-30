/**
 * 像人一点：去 AI 排版、把一段话拆成几条发、按字数「打字」再发。
 * 纯函数（除 sleep），方便单测；不碰网络、不碰配置写盘。
 */

/** 去掉 markdown / 排版味，留下群里能看清的纯文本 */
export function plainChatText(input) {
  let t = String(input ?? '')
  t = t.replace(/[\u200b-\u200d\ufeff]/g, '')          // 零宽字符
  t = t.replace(/```[a-zA-Z0-9+#-]*\n?/g, '')          // 代码围栏标记（内容留着）
  t = t.replace(/`([^`\n]+)`/g, '$1')                  // 行内代码
  t = t.replace(/\*\*([^*\n]+)\*\*/g, '$1')            // **粗**
  t = t.replace(/__([^_\n]+)__/g, '$1')                  // __粗__
  t = t.replace(/(^|\s)\*([^*\n]{1,40})\*(?=\s|$)/g, '$1$2') // *斜*
  t = t.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '$1')      // ![alt](url)
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')      // [text](url)
  t = t.replace(/^\s{0,3}#{1,6}\s+/gm, '')               // # 标题
  t = t.replace(/^\s{0,3}>\s?/gm, '')                    // > 引用
  t = t.replace(/^\s{0,3}[-*+]\s+/gm, '')                // - 列表
  t = t.replace(/^\s{0,3}\d+[.)]\s+/gm, '')             // 1. 列表
  t = t.replace(/^\s*[-*_]{3,}\s*$/gm, '')               // 分隔线
  t = t.replace(/[ \t]+$/gm, '')                          // 行尾空格
  t = t.replace(/\n{3,}/g, '\n\n')                       // 多余空行
  return t.trim()
}

const ENDER = /([。！？!?；;…~～\n]+)/

/** 按句子拆成几条，短碎片合并，最多 maxParts 条 */
export function splitBubbles(input, maxParts = 3, minChars = 12) {
  const text = String(input ?? '').trim()
  const cap = Math.max(1, Math.min(10, Number(maxParts) || 1))
  if (cap <= 1) return [text]
  // 明显分段（空行）就按段发，不因为总字数没到阈值硬塞成一条
  const paras = text.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean)
  if (paras.length >= 2) return paras.slice(0, cap)
  if (text.length < minChars) return [text]
  const raw = text.split(ENDER).reduce((acc, cur, i) => {
    if (i % 2 === 1) acc[acc.length - 1] += cur   // 把标点并回前一句
    else acc.push(cur)
    return acc
  }, []).map((s) => s.trim()).filter(Boolean)
  const target = Math.ceil(text.length / cap)
  // 按「每条大约这么长」装箱，最后一条装剩下的，避免「嗯。」单独飞出去
  const parts = []
  let cur = ''
  for (const piece of raw) {
    if (parts.length === cap - 1) { cur += piece; continue }
    if (cur && (cur + piece).length > target) { parts.push(cur); cur = piece }
    else cur += piece
  }
  if (cur) parts.push(cur)
  // 尾巴太短就并回前一条
  while (parts.length > 1 && parts[parts.length - 1].length < 4) {
    const tail = parts.pop()
    parts[parts.length - 1] += tail
  }
  return parts
}

/** 按字数算「打字」时长：每分钟约 200 字的感觉，带抖动，封顶 maxMs */
export function typingDelayMs(text, { msPerChar = 25, maxMs = 2500, jitter = 0.2 } = {}) {
  const chars = String(text ?? '').length
  const base = Math.min(Number(maxMs) || 0, 250 + chars * (Number(msPerChar) || 0))
  const j = 1 + (Math.random() * 2 - 1) * (Number(jitter) || 0)
  return Math.max(0, Math.round(base * j))
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, Math.max(0, ms)))
}
