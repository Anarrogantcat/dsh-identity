/**
 * 内心活动（不在群里说话时的自己）：每隔一段时间写一句「发呆时想到的」。
 * 只存本地，不发送；注入时只给一句 faint hint，避免污染回复。
 */
import { join } from 'node:path'
import { readJson, writeJson, dirs, audit } from './store.js'
import { readEvents } from './events.js'
import { collectStream } from './llmtext.js'

const dirOf = (peerKey) => join(dirs.root, 'inner', String(peerKey))
const fileOf = (peerKey) => join(dirOf(peerKey), 'latest.json')

export function latestThought(peerKey, maxAgeMs = 6 * 3600 * 1000) {
  try {
    const j = readJson(fileOf(peerKey), null)
    if (!j || !j.text) return null
    if (maxAgeMs > 0 && Date.now() - Number(j.at || 0) > maxAgeMs) return null
    return { text: String(j.text).slice(0, 160), at: Number(j.at || 0) }
  } catch { return null }
}

/** 发一会儿呆：基于最近对话写一句第一人称的念头；失败返回 null */
export async function think(peerKey, cfg, llm) {
  const pk = String(peerKey || '')
  if (!pk || !llm?.stream) return null
  try {
    const evs = readEvents(pk).filter((e) => e.kind === 'talk').slice(-20)
    if (!evs.length) return null
    const digest = evs.map((e) => (e.origin === 'bot' ? '我' : '群友') + '：' + String(e.text || '').slice(0, 70)).join('\n')
    const prompt = [
      '你刚忙完，现在没人在跟你说话，你在发呆。',
      '根据最近的对话，想一句第一人称的念头：可以是想吃的、刚才谁说的话、没做完的事、或者纯粹走神。',
      '要求：一句话，20–50 字，口语；不发出去、不提问、不总结；不提模型/工具/系统。',
      '只输出这一句。',
      digest,
    ].join('\n')
    const r = await collectStream(llm, { provider: String(cfg?.integration?.llmProvider || ''), model: String(cfg?.integration?.llmModel || ''), prompt, maxTokens: 120 })
    const text = String(r?.text || '').replace(/\s+/g, ' ').trim().slice(0, 120)
    if (!text) return null
    const rec = { peerKey: pk, at: Date.now(), text }
    writeJson(fileOf(pk), rec)
    audit('inner.think', { peer: pk.slice(0, 16), chars: text.length })
    return rec
  } catch { return null }
}

/** 注入用：只给最近 2 小时内的念头 */
export function innerHint(peerKey) {
  const t = latestThought(peerKey, 2 * 3600 * 1000)
  return t ? t.text : ''
}
