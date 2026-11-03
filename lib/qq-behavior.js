/**
 * QQ 通道行为判定（从 gate 抽出）：免打扰窗口、是否 @ 了机器人。
 */
export function inQuiet(cfg, now = new Date()) {
  if (!cfg.frequency.quietEnabled) return false
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

let cachedAppId = null
export function appIdOf(readCredentials) {
  if (cachedAppId) return cachedAppId
  try { cachedAppId = readCredentials()?.appId ?? null } catch { cachedAppId = null }
  return cachedAppId
}

export function mentionedBot(content, appId, raw) {
  // ① 事件的 mentions[] 最可靠：全量模式下 @谁都是 <@member_openid>，只看文本认不出是不是机器人
  try {
    const ms = raw && raw.mentions
    if (Array.isArray(ms) && ms.length) {
      if (ms.some((m) => m && (m.bot === true || m.is_bot === true))) return true
      if (appId && ms.some((m) => String((m && m.id) || '').includes(String(appId)))) return true
    }
  } catch { /* ignore */ }
  // ② 旧格式：@机器人是 <@!appId>
  if (appId && new RegExp('<@!?' + appId + '>').test(content)) return true
  return false
}

export function parseDuration(input, defSec) {
  if (!input) return defSec
  const m = String(input).match(/^(\d+(?:\.\d+)?)\s*(s|m|h|秒|分钟|分|小时|时)?$/)
  if (!m) return defSec
  const n = Number(m[1])
  const unit = m[2] ?? 'm'
  if (unit === 's' || unit === '秒') return Math.round(n)
  if (unit === 'h' || unit === '小时' || unit === '时') return Math.round(n * 3600)
  return Math.round(n * 60)
}

/**
 * 她刚跟某个人聊过，隔一两分钟对方接着说一句（「多吃点，别饿着了」）：
 * 没有问号、没有名字，但也算在跟她说话。只在 5 分钟内、话不长时成立。
 */
export function isWarmFollow({ sameSender = false, rtAgeMs = 0, spokeAgeMs = 0, text = '', winSec = 300, maxLen = 30 } = {}) {
  if (!sameSender) return false
  const win = Number(winSec) * 1000
  if (!(rtAgeMs >= 0 && rtAgeMs < win)) return false
  if (!(spokeAgeMs >= 0 && spokeAgeMs < win)) return false
  const t = String(text ?? '').trim()
  if (!t || t.length > Number(maxLen)) return false
  if (/^@\d{5,}/.test(t)) return false
  if (/^(?:\d+|[.。,!！?？~～…]+)$/.test(t)) return false
  return true
}
export function isBareInsultAtMe(text, secSinceSpoke, winSec = 180) {
  const t = String(text ?? '').trim()
  // 只认「就俩字骂你」这种短句：长句里带「笨蛋」往往是说别的东西
  if (!t || t.length > 10) return false
  if (/[?？。，,！!、；;：:]/.test(t)) return false
  if (Number(secSinceSpoke) > Number(winSec)) return false
  return /(笨蛋|傻子|傻|笨|蠢|幼稚|舔狗|自作多情|无聊透顶|闭嘴)/.test(t)
}
