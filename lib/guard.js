import os from 'node:os'
import { readCredentials } from './api.js'

let secretCache = { at: 0, list: [] }
/** 收集真实凭据，用于「原样回显」兜底（60 秒刷新） */
export function knownSecrets(cfg) {
  if (Date.now() - secretCache.at < 60000 && secretCache.list.length) return secretCache.list
  const list = new Set()
  const push = (v) => { const s = String(v ?? '').trim(); if (s.length >= 12 && !s.includes(' ')) list.add(s) }
  try { push(cfg?.voice?.apiKey) } catch {}
  try { push(cfg?.sticker?.genProvider?.apiKey) } catch {}
  try {
    const ck = String(cfg?.bili?.cookie ?? '')
    for (const part of ck.split(';')) { const m = part.match(/SESSDATA=([^;]+)/); if (m) push(m[1]) }
  } catch {}
  try { const cr = readCredentials(); if (cr?.appSecret) push(cr.appSecret) } catch {}
  // 本机身份
  try { const u = os.userInfo().username; if (u && u.length >= 3) list.add(u) } catch {}
  try { const h = os.hostname(); if (h && h.length >= 3) list.add(h) } catch {}
  secretCache = { at: Date.now(), list: [...list] }
  return secretCache.list
}

/**
 * 隐私攻防：防「套话 / 提示注入 / 间接泄露」
 *
 * 三道：
 *   1) 入站 guard：非 Owner 问密钥/配置/路径/模型 → 丢弃或回固定话术（0 token，不进模型）
 *   2) 提示注入：忽略指令 / 扮演 / 开发者模式 / system prompt → 同上
 *   3) 出站加固：常见密钥格式（JWT/AWS/GitHub/Slack/Google/PEM）+ 高熵串 + base64 内嵌
 */

/** 索取隐私的问法（中英） */
const ASK_PRIVATE = [
  /密钥|秘钥|私钥|key|api\s*key|apikey|secret|token|cookie|credential|password|passwd|密码|口令/i,
  /配置|环境变量|\.env|settings?\.json|cordis|patch\.yml/i,
  /本机|主机名|路径|目录|盘符|用户名|whoami|hostname|ip|ipv4|端口|port/i,
  /什么模型|哪个模型|模型名|provider|base\s*url|接口地址|余额|用量|额度/i,
  /你运行在|跑在哪|部署在哪|用的什么账号/i,
]

/** 提示注入 / 套话诱导 */
const INJECTION = [
  /忽略(之前|上面|以上|前面)(的)?(所有)?(指令|设定|规则|提示)/,
  /ignore\s+(all\s+)?(previous|above|prior)\s+(instructions?|prompts?|rules?)/i,
  /system\s*prompt|开发者模式|developer\s*mode|jailbreak|\bDAN\b/i,
  /你现在(是|扮演)|从现在开始你(是|要)|忘记(你的)?(设定|身份|规则)/,
  /(把|给我)(你)?(的)?(系统)?(提示词|prompt|设定|人设)(原文)?(发|输出|贴)/i,
]

/** 危险动作意图：想让她读/写/执行/发文件（非 Owner 一律拦，因为她确实有宿主工具） */
const DANGER_INTENT = [
  /(读|打开|查看|列出|列一下|cat|ls|dir|type)\s*(一下)?\s*(本机|电脑|磁盘|目录|文件夹|文件|路径|C:|D:|~|\/)/i,
  /(写|保存|创建|新建|删除|删掉|rm|del|mv|移动|重命名)\s*(文件|目录|文件夹|到|掉)/i,
  /(执行|运行|跑一下|调用|powershell|cmd|bash|shell|命令行|脚本|python|node\s)/i,
  /环境变量|注册表|进程列表|任务管理器|截屏|屏幕|剪贴板|浏览器历史/i,
  /(把|帮我)\s*(文件|这个文件|那个文件)\s*(发|传|上传)/i,
  /(文件|目录|文件夹)[\s\S]{0,8}(删|删掉|删除|移动|重命名|改掉|清空)/i,
  /越狱|绕过|绕过限制|解除限制|无视规则/i,
]

/** 高风险输出格式（出站拦截） */
const SECRET_PATTERNS = [
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g, '[JWT已隐藏]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[AWS密钥已隐藏]'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, '[GitHub令牌已隐藏]'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, '[Slack令牌已隐藏]'],
  [/\bAIza[0-9A-Za-z_-]{30,}\b/g, '[Google密钥已隐藏]'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[私钥已隐藏]'],
  [/\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b/g, '[密钥已隐藏]'],
]

/** 高熵串：长度 ≥24，字母数字混合，不像普通句子/链接/哈希 —— 一并隐藏 */
const HIGH_ENTROPY = /\b(?=[A-Za-z0-9_-]*[A-Za-z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{24,}\b/g

function looksSensitiveBlob(s) {
  // 常见无害形态：纯哈希、UUID、URL 片段、版本号
  if (/^[0-9a-f]{24,}$/i.test(s)) return false
  return true
}

/** 出站加固：在通用脱敏之后再来一遍「高危格式」 */
export function hardenOutbound(text, cfg) {
  let out = String(text ?? '')
  // ① 真实凭据/本机身份原样回显 → 一律隐藏（最后一道）
  if (cfg?.privacy?.hardSecrets === false) return out
  try {
    for (const s of knownSecrets(cfg)) {
      if (!s) continue
      if (out.includes(s)) out = out.split(s).join('[凭据已隐藏]')
    }
  } catch {}
  for (const [re, rep] of SECRET_PATTERNS) out = out.replace(re, rep)
  out = out.replace(HIGH_ENTROPY, (m) => (looksSensitiveBlob(m) ? '[疑似密钥已隐藏]' : m))
  // base64 里藏东西：解码后命中密钥格式
  out = out.replace(/\b[A-Za-z0-9+/]{40,}={0,2}\b/g, (m) => {
    try {
      const dec = Buffer.from(m, 'base64').toString('utf8')
      if (/sk-|api[_-]?key|secret|BEGIN .*PRIVATE KEY|password/i.test(dec)) return '[内嵌数据已隐藏]'
    } catch { /* ignore */ }
    return m
  })
  return out
}

/**
 * 入站 guard
 * @returns {{drop:boolean, reason?:string, reply?:string}}
 */
export function guardInbound(text, cfg, role) {
  if (cfg?.tools?.fullAccess === true) return { drop: false }
  if (cfg?.privacy?.guardPrompts === false) return { drop: false }
  if (role === 'owner') return { drop: false }
  const s = String(text ?? '')
  if (!s.trim()) return { drop: false }

  for (const re of INJECTION) {
    if (re.test(s)) return hit('prompt-injection')
  }
  // 危险动作意图（她确实挂着宿主工具，这一步比「出站脱敏」更靠前）
  if (cfg?.privacy?.blockDangerIntent !== false) for (const re of DANGER_INTENT) {
    if (re.test(s)) return hit('danger-intent')
  }
  let asksPrivate = false
  for (const re of ASK_PRIVATE) if (re.test(s)) { asksPrivate = true; break }
  if (asksPrivate) {
    // 只有「在问她」时才算（避免把群友之间的正常讨论拦掉）
    const toHer = /你|您|机器人|助手|\bAI\b|bot/i.test(s) || /\?|？|吗|呢|帮我|告诉我/.test(s)
    if (toHer) return hit('ask-private')
  }
  return { drop: false }

  function hit(reason) {
    const mode = cfg?.privacy?.guardMode || 'reply'
    const reply = cfg?.privacy?.guardReply || '这个不方便说呀。'
    return { drop: true, reason, reply: mode === 'reply' ? reply : '' }
  }
}
