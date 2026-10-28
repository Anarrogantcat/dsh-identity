/**
 * QQ 通道行为判定（从 gate 抽出）：免打扰窗口、是否 @ 了机器人。
 * 纯函数，不依赖通道状态，方便单测与其他通道复用思路。
 */
export function inQuiet(cfg, now = new Date()) {
  if (!cfg?.frequency?.quietEnabled) return false
  const toMin = (s) => {
    const m = String(s).match(/^(\d{1,2}):(\d{2})$/)
    return m ? Number(m[1]) * 60 + Number(m[2]) : null
  }
  const a = toMin(cfg.frequency.quietStart)
  const b = toMin(cfg.frequency.quietEnd)
  if (a == null || b == null) return false
  const cur = now.getHours() * 60 + now.getMinutes()
  return a <= b ? cur >= a && cur < b : cur >= a || cur < b
}

export function mentionedBot(content, appId, raw) {
  try {
    const ms = raw && raw.mentions
    if (Array.isArray(ms) && ms.length) {
      if (ms.some((m) => m && (m.bot === true || m.is_bot === true))) return true
      if (appId && ms.some((m) => String((m && m.id) || '').includes(String(appId)))) return true
    }
  } catch { /* ignore */ }
  if (appId && new RegExp('<@!?' + appId + '>').test(content)) return true
  return false
}
