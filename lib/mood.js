/**
 * 心情（本地自带，零第三方依赖）
 *
 * 情绪状态由 lib/moodlocal.js 计算（读群聊信号），本模块只负责把它翻译成：
 *   1) 表情包情绪词（[[sticker:auto]]）
 *   2) 接话概率倍率（心情低就少说话）
 *   3) 语音风格（cute / gentle）
 *   4) 写进提示词的「语气建议」
 *
 * 不再读取任何第三方插件（旧的 dsh-feiyu-mood 读取器已在 P1 移除）。
 */
import { readLocalMood } from './moodlocal.js'

/** 读心情：唯一来源是本地引擎；没有就是 null（不假装有情绪） */
export function readMood(cfg) {
  return readLocalMood() ?? null
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

