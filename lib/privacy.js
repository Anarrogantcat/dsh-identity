/**
 * 隐私规则：内置脱敏/拦截 + 自定义补充
 * 设计原则：
 *   · 出站「脱敏」优先于「拦截」——能不泄露就行，不必打断对话
 *   · 内置拦截只针对「索要隐私」的问法，且 Owner 豁免（你自己可以随便聊）
 *   · 自定义规则永远生效；内置规则可用 defaultRules 一键关
 */

/** 出站 / 入库 脱敏（内置） */
const BUILTIN_REDACT = [
  [/\b1[3-9]\d{9}\b/g, '[手机号]'],
  [/\b[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]\b/g, '[身份证]'],
  [/\b\d{16,19}\b/g, '[卡号]'],
  [/[\w.+-]+@[\w-]+\.[A-Za-z]{2,}/g, '[邮箱]'],
  [/\b(?:10|172|192|127|169\.254)\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '[内网地址]'],
  [/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[密钥已隐藏]'],
  [/\bBearer\s+[A-Za-z0-9._-]{10,}/gi, 'Bearer [已隐藏]'],
  [/\b(api[_-]?key|token|secret|password|passwd|cookie|sessdata)\s*[:=]\s*["']?[^\s"',，。；]{6,}/gi, '$1=[已隐藏]'],
  [/[A-Za-z]:\\[^\s"'，。；）)\]]{3,}/g, '[本机路径]'],
  [/(?:^|[\s(])\/(?:home|root|Users)\/[^\s"'，。；）)\]]+/g, ' [本机路径]'],
  [/~\/\.dsh[^\s"'，。；）)\]]*/g, '[配置路径]'],
  [/(?:\.credentials\.yaml|auth\.json|id_rsa|\.env)\b/gi, '[敏感文件]'],
  [/\b(?:deepseek-(?:account|flash|chat|reasoner)|gpt-4[o0]?|claude-[a-z0-9.-]+)\b/gi, '模型[已隐藏]'],
]

/** 入站拦截（内置）：只在「索要隐私」时丢；Owner 豁免 */
const BUILTIN_BLOCK = [
  '身份证号', '银行卡号', '家庭住址', '你的密钥', 'api key', 'access token',
  'cookie 发我', '读取本机', '读一下我的', '把配置发我', '导出配置',
]

/** 内置拦截默认关：避免把正常聊天误杀（可在面板开） */
export const BUILTIN_BLOCK_ENABLED = false

function applyPatterns(text, patterns) {
  let out = text
  for (const [re, rep] of patterns) out = out.replace(re, rep)
  return out
}

const URL_RE = /\bhttps?:\/\/[^\s"'<>，。；）)\]]+/gi

/** 取 URL 的主机名（小写，去端口）；取不到返回空串 */
export function hostOf(url) {
  try { return new URL(String(url)).hostname.toLowerCase() } catch { return '' }
}

/**
 * 外链主机白名单：allowedHosts 非空时，白名单以外的链接替换掉。
 * 只在出站生效；空数组 = 不限制。
 */
export function filterLinks(text, cfg) {
  const hosts = (cfg?.privacy?.allowedHosts ?? []).map((h) => String(h ?? '').trim().toLowerCase()).filter(Boolean)
  if (!hosts.length) return String(text ?? '')
  return String(text ?? '').replace(URL_RE, (u) => {
    const h = hostOf(u)
    if (!h) return u
    const hit = hosts.some((allowed) => h === allowed || h.endsWith('.' + allowed))
    return hit ? u : '[外链已隐藏]'
  })
}

/** 脱敏：内置（可关）+ 自定义词 */
export function redactText(text, cfg) {
  let out = String(text ?? '')
  const p = cfg?.privacy ?? {}
  if (p.defaultRules !== false) out = applyPatterns(out, BUILTIN_REDACT)
  for (const w of p.redactKeywords ?? []) {
    if (!w) continue
    out = out.split(w).join('[已隐藏]')
  }
  // 额外脱敏 @昵称：CQ @ 和「@后面的名字」都抹掉（邮箱/网址里的 @ 不动）
  if (p.redactNames === true) {
    const MARK = '\u0000name\u0000'
    out = out
      .replace(/<@!?\d+>/g, MARK)
      .replace(/(?<![\w.@/])@[\w\u4e00-\u9fa5]{1,16}/g, MARK)
      .split(MARK).join('[@某人]')
  }
  return out
}

/** 是否该丢：自定义词永远生效；内置词仅 defaultRules 开且非 owner */
export function shouldDrop(text, cfg, role) {
  const p = cfg?.privacy ?? {}
  const s = String(text ?? '')
  for (const w of p.blockKeywords ?? []) {
    if (w && s.includes(w)) return { drop: true, rule: 'custom' }
  }
  // 丢弃含链接的消息（Owner 不受影响；防止别人往群里灌外链）
  if (p.blockLinks === true && role !== 'owner' && URL_RE.test(s)) {
    URL_RE.lastIndex = 0
    return { drop: true, rule: 'link' }
  }
  URL_RE.lastIndex = 0
  if (p.blockBuiltin === true && role !== 'owner') {
    for (const w of BUILTIN_BLOCK) {
      if (s.toLowerCase().includes(w)) return { drop: true, rule: `builtin:${w}` }
    }
  }
  return { drop: false }
}

/** 记忆入库前脱敏（默认开） */
export function redactForMemory(text, cfg) {
  if (cfg?.privacy?.memoryRedact === false) return String(text ?? '')
  return redactText(text, cfg)
}

export const RULES = { BUILTIN_REDACT, BUILTIN_BLOCK }

