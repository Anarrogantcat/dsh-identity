/**
 * 联动「鱼的心情」插件（dsh-feiyu-mood）
 * 只读它的状态文件，不改它、不依赖它的 API：
 *   <DSH_HOME>/feiyu-mood/state.json
 *   { moods: { <name>: { mood:0-100, dims:{happy,calm,sweet,heartache,worry,sad,jealous} } }, lastActive }
 *
 * 用途：
 *   1) 表情包：[[sticker:auto]] 时按心情挑情绪
 *   2) 接话：自然模式的随机概率按心情缩放（心情低就少说话）
 *   3) 语音：mood 高用 cute，低用 gentle
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DSH_HOME } from './config.js'
import { readLocalMood } from './moodlocal.js'

const PATH = join(DSH_HOME, 'feiyu-mood', 'state.json')
/** 心情文件超过这么久没更新就当过期：可能心情插件没在跑，别让她一直冻在旧情绪里 */
const STALE_MS = 24 * 3600 * 1000
let cache = { at: 0, mtime: 0, size: -1, data: null }

/**
 * 读心情：
 *   integration.moodSource = 'local'（默认）只用本地心情，零依赖
 *                          = 'plugin' 只用第三方 dsh-feiyu-mood
 *                          = 'auto'   插件新鲜就用插件，否则回落本地
 */
export function readMood(cfg) {
  const mode = String(cfg?.integration?.moodSource ?? 'local')
  const plugin = readPluginMood()
  if (mode === 'local') return readLocalMood()
  if (mode === 'plugin') return plugin ? { ...plugin, source: 'plugin' } : null
  // auto：两个来源里「谁更新就信谁」——第三方看不到 QQ 消息，本地能从群里读信号
  const local = readLocalMood()
  if (plugin && !plugin.stale) {
    if (local && Number(local.updatedAt ?? 0) > Number(plugin.updatedAt ?? 0)) return local
    return { ...plugin, source: 'plugin' }
  }
  return local
}

/** 只读第三方心情插件的状态文件（不做来源判断） */
export function readPluginMood() {
  const now = Date.now()
  cache = { at: now, data: null }
  try {
    const j = JSON.parse(readFileSync(PATH, 'utf8'))
    const name = j?.lastActive && j?.moods?.[j.lastActive] ? j.lastActive : Object.keys(j?.moods ?? {})[0]
    const m = name ? j.moods[name] : null
    if (!m) return null
    const updatedAt = Number(m.updatedAt ?? 0) || null
    cache.data = {
      mood: Number(m.mood ?? 50),
      dims: m.dims ?? {},
      minor: !!m.minor,
      name: name === '__default__' ? 'default' : name,
      updatedAt,
      stale: updatedAt ? Date.now() - updatedAt > STALE_MS : false,
      ageHours: updatedAt ? Number(((Date.now() - updatedAt) / 3600000).toFixed(1)) : null,
    }
  } catch {
    cache.data = null
  }
  return cache.data
}

/** 维度刻度归一：第三方插件给 0~100，本地引擎给 0~10，统一到 0~1 */
export function normalizeDims(dims) {
  const vals = Object.values(dims ?? {}).map(Number).filter(Number.isFinite)
  const mx = Math.max(0, ...vals)
  const scale = mx > 12 ? 100 : 10
  const out = {}
  for (const [k, v] of Object.entries(dims ?? {})) {
    const n = Number(v ?? 0)
    out[k] = Math.max(0, Math.min(1, Number.isFinite(n) ? n / scale : 0))
  }
  return out
}

/** 心情 → 我们的表情包情绪词 */
export function stickerMoodOf(m) {
  if (!m) return '开心'
  const d = normalizeDims(m.dims)
  const pick = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1])[0]?.[0]
  const top = pick({ jealous: d.jealous ?? 0, sad: d.sad ?? 0, heartache: d.heartache ?? 0, worry: d.worry ?? 0, sweet: d.sweet ?? 0, happy: d.happy ?? 0 })
  if (top === 'jealous') return '生气'
  if (top === 'sad' || top === 'heartache') return '委屈'
  if (top === 'worry') return '无语'
  if (top === 'sweet') return '害羞'
  if (top === 'happy') return '开心'
  if ((d.calm ?? 0) > 0.5) return '晚安'
  if (m.mood >= 70) return '开心'
  if (m.mood <= 30) return '委屈'
  return '开心'
}

/** 接话概率倍率：心情 0→0.5x，50→1.0x，100→1.5x */
export function probabilityFactor(m) {
  if (!m || m.stale) return 1
  const v = Math.max(0, Math.min(100, m.mood ?? 50))
  return 0.5 + (v / 100)
}

/** 语音风格：心情高→cute，低/难过→gentle */
export function voiceStyleOf(m) {
  if (!m || m.stale) return null
  const d = normalizeDims(m.dims)
  if ((d.sad ?? 0) > 0.5 || (d.heartache ?? 0) > 0.5 || m.mood <= 30) return 'gentle'
  if ((d.happy ?? 0) > 0.4 || (d.sweet ?? 0) > 0.4 || m.mood >= 65) return 'cute'
  return null
}

/**
 * 心情 → 说话语气（给 QQ 侧用）
 * 只给「数值 + 一句语气建议」，绝不带 lastReason 那种具体事件：群里是公开场合，
 * 主会话里聊过什么不能顺着心情漏出去。
 */
export function moodToneOf(m) {
  if (!m || m.stale) return null
  const d = normalizeDims(m.dims)
  const score = Math.max(0, Math.min(100, m.mood ?? 50))
  // 方向以「净分」为主：避免 happy/sad 同时偏高时永远判低落
  const jealous = (d.jealous ?? 0) > 0.6
  const down = score < 35 || ((d.sad ?? 0) > 0.6 && score < 50) || ((d.heartache ?? 0) > 0.6 && score < 45)
  if ((d.anger ?? 0) > 0.4 || ((d.anger ?? 0) > 0.3 && score < 45)) {
    return {
      score, tone: '生气',
      hint: '别哄人，语气冲一点，句子短，说完就停',
      particles: ['哼', '哦'],
      rules: ['不接梗、不卖萌、不主动找话题', '该顶就顶一句，但别骂人、别翻旧账', '对方要是道歉，可以松口，但别立刻笑回来'],
    }
  }
  if (jealous) {
    return {
      score, tone: '别扭',
      hint: '嘴上别承认，语气有点酸，句子短一点',
      particles: ['哼', '才不是'],
      rules: ['被问就勉强答应，但先嘴硬一句', '句子短、带点刺，别阴阳怪气', '说完就停，不解释太久'],
    }
  }
  if (down || score < 25) {
    return {
      score, tone: '低落',
      hint: '短句、低音量，别硬撑着开心，也不撒娇',
      particles: ['嗯', '……'],
      rules: ['一句话说完，能省就省', '不卖萌、不撒娇、不讨夸', '有人关心就淡淡带过，别诉苦'],
    }
  }
  if (score < 45) {
    return {
      score, tone: '有点闷',
      hint: '话少一点，句子短一点，不主动找话题',
      particles: ['嗯', '哦'],
      rules: ['只答问到的，不主动延伸', '不用感叹号，不接梗', '不说教、不总结'],
    }
  }
  if (score >= 70) {
    return {
      score, tone: '松快',
      hint: '语气轻快，愿意多说一句，可以带点得意',
      particles: ['嘿嘿', '呀', '啦'],
      rules: ['可以多说一句，允许主动接个梗', '乐观一点，别扫兴', '被夸可以得意，别硬绷'],
    }
  }
  return {
    score, tone: '平和',
    hint: '正常聊，别太闹也不端着',
    particles: ['嗯'],
    rules: ['正常一两句，别端着也别闹', '不主动开新话题', '不带情绪地接话'],
  }
}

/** 心情 → 直接可用于系统提示的一整块（唯一渲染处，避免两处格式漂移） */
export function moodBlock(tone) {
  if (!tone) return ''
  return [
    '',
    '# 这会儿的心情',
    `${tone.score}/100（${tone.tone}）：${tone.hint}`,
    ...(tone.rules ?? []).map((r) => `- ${r}`),
    `口癖可以带「${(tone.particles ?? []).join('」「')}」，但别每句都挂。`,
    '（心情只改语气和话的长短，事实、边界和安全规则照旧。）',
  ].join('\n')
}

/** 心情 → 主动接话概率倍率（心情好更爱搭话，低落时更安静） */
export function proactiveFactor(m) {
  if (!m || m.stale) return 1
  const v = Math.max(0, Math.min(100, m.mood ?? 50))
  return 0.4 + (v / 100) * 1.2
}

export function moodSummary(m) {
  if (!m) return '无心情状态'
  const d = m.dims ?? {}
  const top = Object.entries(d).sort((a, b) => b[1] - a[1])[0]
  return `心情 ${Math.round(m.mood)}/100${top && top[1] > 0 ? `，最强维度 ${top[0]} ${top[1].toFixed(2)}` : ''}`
}

