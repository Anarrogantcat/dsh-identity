/**
 * 语音：把文字送进本地「肥鱼声音服务」（astrbot_plugin_feiyu_voice 附带的 server），
 * 拿回 WAV → 编码成 SILK → 用 QQ 语音消息发出。
 *
 * 协议（服务端 README）：
 *   POST /v1/speech  {"voice":"feiyu","text":"…","style":"cute"}  → 202 + job id
 *   GET  /v1/jobs/{id}          → 轮询状态
 *   GET  /v1/jobs/{id}/audio    → WAV
 *   Authorization: Bearer <api_key>
 *
 * 本模块不加载任何模型：模型与 GPU 环境在服务侧。失败一律返回 {ok:false}，由调用方降级为文字。
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dirs } from './store.js'

let silkMod = null
async function getSilk() {
  if (silkMod) return silkMod
  try {
    // silk-wasm 在 profile 的 node_modules 里（qqbot SDK 的可选依赖）
    const mod = await import('silk-wasm')
    silkMod = mod.default ?? mod
    return silkMod
  } catch {
    try {
      const { createRequire } = await import('node:module')
      const req = createRequire(new URL('../package.json', import.meta.url))
      const p = req.resolve('silk-wasm')
      silkMod = (await import(new URL(`file://${p.replace(/\\/g, '/')}`).href)).default ?? (await import(new URL(`file://${p.replace(/\\/g, '/')}`).href))
      return silkMod
    } catch {
      return null
    }
  }
}

async function apiFetch(cfg, path, init = {}) {
  const base = String(cfg.baseUrl ?? '').replace(/\/$/, '')
  if (!base) throw new Error('未配置声音服务地址')
  const res = await fetch(base + path, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}),
    },
  })
  return res
}

function jobIdOf(data) {
  if (!data || typeof data !== 'object') return null
  const v = data.job_id ?? data.jobId ?? data.id ?? data.job?.id ?? data.task_id
  return v ? String(v) : null
}

function statusOf(data) {
  if (!data || typeof data !== 'object') return ''
  return String(data.status ?? data.state ?? data.job?.status ?? '').toLowerCase()
}

/** 提交一次 TTS，返回 WAV Buffer（失败抛错） */
export async function synthesize(cfg, text) {
  const body = { voice: cfg.voiceId || 'feiyu', text: String(text ?? '').slice(0, cfg.maxChars ?? 120), style: cfg.style || 'cute' }
  const res = await apiFetch(cfg, '/v1/speech', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text1 = await res.text()
  let data = null
  try { data = JSON.parse(text1) } catch { data = { raw: text1 } }
  if (!res.ok && res.status !== 202) throw new Error(`提交失败 HTTP ${res.status}: ${String(text1).slice(0, 120)}`)

  const id = jobIdOf(data)
  if (!id) throw new Error('服务没返回任务 id')

  const deadline = Date.now() + (cfg.pollTimeoutSec ?? 60) * 1000
  let last = ''
  while (Date.now() < deadline) {
    const r2 = await apiFetch(cfg, `/v1/jobs/${id}`)
    const j = await r2.json().catch(() => ({}))
    last = statusOf(j) || last
    if (last === 'success' || last === 'succeeded' || last === 'done' || last === 'completed') break
    if (last === 'failed' || last === 'error' || last === 'interrupted') throw new Error(`任务失败：${last} ${j.error ?? ''}`.slice(0, 160))
    await new Promise((r) => setTimeout(r, 600))
  }
  if (!(last === 'success' || last === 'succeeded' || last === 'done' || last === 'completed')) {
    throw new Error(`等待超时（最后状态 ${last || 'unknown'}）`)
  }

  const r3 = await apiFetch(cfg, `/v1/jobs/${id}/audio`)
  if (!r3.ok) throw new Error(`取音频失败 HTTP ${r3.status}`)
  const buf = Buffer.from(await r3.arrayBuffer())
  if (buf.length < 100) throw new Error('音频为空')
  return { wav: buf, jobId: id }
}

/** WAV → SILK（silk-wasm 直接吃 WAV，传 sampleRate=0 让它自己读头） */
export async function wavToSilk(wavBuf) {
  const silk = await getSilk()
  if (!silk?.encode) return null
  const out = await silk.encode(new Uint8Array(wavBuf), 0)
  if (!out?.data) return null
  return { silk: Buffer.from(out.data), durationMs: out.duration ?? 0 }
}

/** 完整链路：文字 → SILK 文件 → 路径（失败返回 {ok:false}） */
export async function speakToFile(cfg, text, tag = 'voice') {
  try {
    const { wav } = await synthesize(cfg, text)
    const enc = await wavToSilk(wav)
    if (!enc) return { ok: false, error: 'silk 编码不可用' }
    const p = join(dirs.tmp, `${tag}-${Date.now()}.silk`)
    writeFileSync(p, enc.silk)
    return { ok: true, file: p, silk: enc.silk, durationMs: enc.durationMs, bytes: enc.silk.length }
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err) }
  }
}

/** 发语音：优先 buffer，失败回落本地文件 */
export async function sendVoice(bot, target, result) {
  if (!result?.ok) return false
  try {
    await bot.sendVoice(target, { buffer: result.silk, fileName: 'voice.silk' })
    return true
  } catch {
    try {
      await bot.sendVoice(target, { localPath: result.file })
      return true
    } catch {
      return false
    }
  }
}

export function voiceConfig(cfg) {
  const v = cfg?.voice ?? {}
  return {
    enabled: v.enabled === true,
    baseUrl: v.baseUrl || '',
    apiKey: v.apiKey || '',
    voiceId: v.voiceId || 'feiyu',
    style: v.style || 'cute',
    maxChars: v.maxChars ?? 120,
    pollTimeoutSec: v.pollTimeoutSec ?? 60,
    autoRead: v.autoRead === true,
    perGroupHour: v.perGroupHour ?? 10,
  }
}

/** 最近一次合成结果（面板显示用） */
let lastJob = null
export function recordLastJob(ok, error = '') {
  lastJob = { ok: !!ok, error: String(error ?? '').slice(0, 200), at: Date.now() }
}
export function lastJobInfo() { return lastJob }

/** 探活：/health + /v1/capabilities（带 key），给面板看服务到底行不行 */
export async function probeService(cfg, timeoutMs = 6000) {
  const vc = voiceConfig(cfg)
  const out = { enabled: vc.enabled, baseUrl: vc.baseUrl, voiceId: vc.voiceId, style: vc.style, keySet: !!vc.apiKey, ok: false, health: '', caps: null, error: '' }
  if (!vc.baseUrl) { out.error = '没填服务地址'; return out }
  const h = (p) => (/^https?:/i.test(vc.baseUrl) ? vc.baseUrl.replace(/\/$/, '') : vc.baseUrl) + p
  try {
    const r = await fetch(h('/health'), { signal: AbortSignal.timeout(timeoutMs) })
    out.health = r.ok ? (await r.text()).slice(0, 200) : ('HTTP ' + r.status)
    out.ok = r.ok
  } catch (err) { out.error = '连不上服务：' + String(err?.message ?? err).slice(0, 120); return out }
  try {
    const r = await fetch(h('/v1/capabilities'), {
      headers: vc.apiKey ? { authorization: 'Bearer ' + vc.apiKey } : {},
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (r.ok) out.caps = await r.json()
    else out.error = '能力接口 HTTP ' + r.status
  } catch (err) { out.error = '能力接口失败：' + String(err?.message ?? err).slice(0, 120) }
  return out
}