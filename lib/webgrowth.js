/**
 * web / 非 QQ 会话的成长入口：接宿主 ctx.on('session/event')。
 * 只处理没有被通道适配器认领的会话（QQ 由 gate 自己记录），避免重复。
 */
import { appendEvent } from './events.js'
import { resolveSession } from './channel.js'
import { addMemory } from './memory.js'
import * as moodv2 from './moodv2.js'
import * as empathy from './empathy.js'
import * as pace from './pace.js'
import { pushTalk, due, distill } from './judge.js'
import { redactForMemory } from './privacy.js'
import { audit } from './store.js'
import { loadReflection, reflectDayLlm } from './reflection.js'
import { dayStr } from './diary.js'

/**
 * 宿主会往会话里塞一些"看起来像用户消息"的东西：运行环境快照、技能目录提醒、
 * 系统提示词副本、每一步的时间采样行。它们不是群友说的话，记进记忆就是污染——
 * 以后还会被当成"你自己说的/群友说的"再注回提示词。这里按特征剔掉。
 */
const HOST_BLOCK_RES = [
  /<system-reminder>[\s\S]*?<\/system-reminder>/gi,
  /<system-reminder>[\s\S]*$/i, // 未闭合的截断块
  // goal_round / goal_blocked：宿主自动续跑和收尾时注入的目标块，整块剥掉。
  // 不剥的话会被当成「用户说的话」记进记忆——实测已经污染了十几条，
  // 而且会被当成长篇原话再注回提示词。
  /<goal_(?:round|blocked)>[\s\S]*?<\/goal_(?:round|blocked)>/gi,
  /<goal_(?:round|blocked)>[\s\S]*$/i,
  /^objective:\s*"[^"]*"\s*$/gim,
]
// 宿主每步会插的元信息行：整行丢掉，真话照留
// （"Elapsed since the preceding step context" 和 "...model-visible message" 都是它）
const HOST_LINE_RES = [
  /^time sampled while preparing turn\b.*$/gim,
  /^elapsed since the preceding\b.*$/gim,
  /^browser time zone for this request\b.*$/gim,
]
const HOST_ONLY_RES = [
  /^current runtime context\./i,
  /this snapshot supersedes earlier runtime-context snapshots/i,
  /^you are an ai agent powered by deepseek harness/i,
  /^the runtime context names the deepseek harness implementation checkout/i,
]

/** 剥掉宿主注入块；整条都是注入就返回空串 */
export function stripHostInjection(text, cfg) {
  if (cfg?.memory?.skipHostInjection === false) return String(text ?? '')
  let t = String(text ?? '')
  for (const re of HOST_BLOCK_RES) t = t.replace(re, ' ')
  for (const re of HOST_LINE_RES) t = t.replace(re, ' ')
  const head = t.replace(/\s+/g, ' ').trim()
  if (!head) return ''
  if (HOST_ONLY_RES.some((re) => re.test(head))) return ''
  return head
}

/**
 * 消息里可能有几段：reasoning / tool-call / text。
 * 只有 type 是 text 的才是"她说出口的话"。以前只排除 tool，
 * 结果每条 assistant/message 都把 reasoning（内部草稿）当发言记下来——
 * 5627 条消息里 4664 条根本没有正文，全被记成了英文独白。
 */
function textOf(v, depth = 0) {
  if (depth > 5 || v == null) return ''
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return v.map((x) => textOf(x, depth + 1)).filter(Boolean).join(' ')
  if (typeof v === 'object') {
    if (typeof v.text === 'string') {
      if (v.type == null || v.type === 'text') return v.text
      return '' // reasoning / tool-call / image … 都不是发言
    }
    if (v.content) return textOf(v.content, depth + 1)
    if (v.message) return textOf(v.message, depth + 1)
    if (v.data) return textOf(v.data, depth + 1)
  }
  return ''
}

/** web 会话也该有复盘：QQ 那边是 22:00 定时，web 没这个待遇 */
const talkTick = new Map()
const REFLECT_EVERY = 20
function maybeReflect(pk, cfg, getLlm, logger) {
  const n = (talkTick.get(pk) ?? 0) + 1
  talkTick.set(pk, n)
  if (n % REFLECT_EVERY !== 0) return
  const llm = getLlm?.()
  void (async () => {
    try {
      const date = dayStr()
      if (loadReflection(pk, date)) return // 今天已经复盘过
      await reflectDayLlm(pk, cfg, llm)
      try { audit('web.reflect', { peer: String(pk).slice(0, 14), n }) } catch { /* ignore */ }
    } catch (err) {
      logger?.warn?.('[identity] web 复盘失败：' + (err?.message ?? err))
    }
  })()
}

export function installSessionGrowth(ctx, { getConfig, logger = console, getLlm = () => null } = {}) {
  if (!ctx || typeof ctx.on !== 'function') return false
  try {
    ctx.on('session/event', (session, event) => {
      try {
        const sid = String(session?.header?.id ?? session?.id ?? '')
        if (!sid) return
        if (resolveSession(sid)) return // QQ 等已认领的会话不重复记
        const type = String(event?.type ?? '')
        if (type !== 'user/message' && type !== 'assistant/message') return
        // 两种消息的形状不一样：user/message 的 data 本身就是消息（role+content），
        // assistant/message 才包在 data.message 里。以前只取 data.message，
        // 结果用户消息永远 text 为空被丢掉——web 会话的记忆一直是空的。
        const raw = event?.data?.message ?? event?.message ?? (type === 'user/message' ? event?.data : null) ?? event?.content
        const cfg = getConfig?.() ?? {}
        // 先剥注入再折叠空白：时间采样行的特征是按行识别的，先折叠就认不出来了
        const text = stripHostInjection(textOf(raw), cfg).replace(/\s+/g, ' ').trim().slice(0, 300)
        if (!text) return
        const origin = type === 'assistant/message' ? 'bot' : 'inbound'
        // 她说话也要累：以前只有 QQ 的发送路径会 noteReply，web 会话永远满精力——
        // 「会累」只在群里成立，私下聊再多也不困。
        if (origin === 'bot') { try { pace.noteReply() } catch { /* ignore */ } }
        const pk = 'web_' + sid
        const ref = sid + ':' + String(event?.seq ?? event?.id ?? event?.data?.turn ?? Date.now())
        const memText = redactForMemory(text, cfg)
        // 共情：先给上一条记结果，再认这次的情绪。
        // 以前这条链只在 QQ 通道里有，web 会话完全没共情——私下聊反而最不共情。
        try {
          if (origin === 'inbound') {
            empathy.noteOutcome(pk, memText)
            const em = empathy.detect(memText)
            // 只记「对方在讲自己」的情绪；对着她说的话（教她怎么回、让她撒火）不算共情事件
            if (em && empathy.isSelfState(memText)) empathy.record({ peer: pk, who: '对方', text: memText, bond: 0, ...em })
          }
        } catch { /* ignore */ }
        // 事件流留原话当证据；记忆池只收有信息量的（「嗯」「哈哈」不留）
        appendEvent(pk, { kind: 'talk', origin, text: memText, ref })
        pushTalk(pk, origin === 'inbound' ? 'user' : 'self', memText)
        if (origin === 'inbound' && cfg.memory?.enabled) {
          try {
            if (worthRemembering(memText)) {
              addMemory(pk, { text: memText, category: guessCategory(memText), importance: guessImportance(memText), emotion: moodv2.intensity(), valence: moodv2.valence(), source: 'web', origin: 'user' }, cfg)
            }
          } catch { /* ignore */ }
          // 攒够一段就调一次模型，把这段压成判断（失败不挡消息，下一轮再试）
          try {
            if (due(pk, cfg)) {
              void distill(pk, { cfg, llm: getLlm?.(), logger }).catch((err) => logger?.warn?.('[identity] judge failed: ' + (err?.message ?? err)))
            }
          } catch { /* ignore */ }
          // 攒够一段对话，给这个 web 会话也补一次当天复盘（不然它只在 QQ 那边有日子过）
          try { maybeReflect(pk, cfg, getLlm, logger) } catch { /* ignore */ }
        }
        try { audit('web.growth', { sid: String(sid).replace(/^session-/, '').slice(0, 8), origin, len: text.length }) } catch { /* ignore */ }
      } catch (err) {
        logger.warn?.('[identity] session growth failed: ' + (err?.message ?? err))
      }
    })
    return true
  } catch { return false }
}

/** 短反应、纯语气词不值得占一条记忆；原话还在事件流里，要查也查得到 */
const NOISE_RE = /^(哈+|嘿+|嗯+|哦+|噢+|啊+|呀+|草|6|牛|好|行|可以|收到|笑死|啊这|确实|对的|是的|？+|[!！]+|\[[^\]]{0,12}\])$/i
function worthRemembering(t) {
  const s = String(t ?? '').trim()
  if (s.length < 6) return false
  if (NOISE_RE.test(s)) return false
  return true
}

const PREF_RE = /(我不喜欢|我讨厌|我最爱|我喜欢|我爱|我受不了|我不吃|我不喝|我更喜欢|记住|以后别|不要再)/
const FACT_RE = /(我是|我叫|我在|我住|我有|我养|我在做|我玩|我下|我明|我今|我这)/
function guessCategory(t) {
  if (PREF_RE.test(t)) return 'preference'
  if (FACT_RE.test(t)) return 'fact'
  return 'event'
}
function guessImportance(t) {
  if (PREF_RE.test(t)) return 0.65
  if (FACT_RE.test(t)) return 0.55
  if (/[？?]|怎么|为什么|能不能|如何|是不是/.test(t)) return 0.45
  return 0.3
}
