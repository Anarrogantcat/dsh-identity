/**
 * 语音转写（S3 / I5）：可选，默认关闭
 *
 * 为什么不做内置引擎：whisper 需要 ffmpeg 转 wav + 模型文件，装进插件里不合适。
 * 这里给一个「你装什么我用什么」的壳：
 *   stt.enabled = true
 *   stt.command = 'whisper-cli -m D:\models\ggml-small.bin -f {file} -otxt -of {out}'
 * 命令里的 {file} 会被替换成语音文件绝对路径、{out} 替换成输出前缀；
 * 优先读 {out}.txt，没有就把 stdout 当结果。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

const errText = (err) => String(err?.message ?? err).slice(0, 160)

export function sttConfig(cfg) {
  const s = cfg?.stt ?? {}
  return {
    enabled: s.enabled === true,
    command: String(s.command ?? '').trim(),
    timeoutMs: Math.max(2000, Number(s.timeoutMs ?? 30000)),
  }
}

/** 把语音直链/本地路径落成临时文件，返回路径（失败返回 ''） */
export async function saveRecordFile(source, ext = '.silk') {
  const src = String(source ?? '')
  if (!src) return ''
  try {
    if (/^file:/.test(src) || /^[A-Za-z]:[\\/]/.test(src) || src.startsWith('/')) {
      const p = src.replace(/^file:\/\/\//, '')
      return existsSync(p) ? p : ''
    }
    if (!/^https?:/.test(src)) return ''
    const dir = join(tmpdir(), 'qqbot-refine-voice')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const out = join(dir, Date.now().toString(36) + ext)
    const res = await fetch(src, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) return ''
    const buf = Buffer.from(await res.arrayBuffer())
    if (!buf.length) return ''
    writeFileSync(out, buf)
    return out
  } catch { return '' }
}

/** 跑转写命令；没配置 / 失败 / 超时都返回 ''（调用方降级成 [语音] 占位） */
export async function transcribeFile(file, cfg, logger = console) {
  const conf = sttConfig(cfg)
  if (!conf.enabled || !conf.command || !file) return { ok: false, reason: '未启用或未配置命令' }
  const out = file.replace(/\.[^.]+$/, '') + '-stt'
  const line = conf.command.replace(/\{file\}/g, JSON.stringify(file)).replace(/\{out\}/g, JSON.stringify(out))
  return await new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let done = false
    const finish = (r) => { if (!done) { done = true; resolve(r) } }
    let child
    try {
      child = spawn(line, { shell: true, windowsHide: true })
    } catch (err) {
      return finish({ ok: false, reason: errText(err) })
    }
    const timer = setTimeout(() => { try { child.kill() } catch { /* ignore */ } finish({ ok: false, reason: '转写超时' }) }, conf.timeoutMs)
    timer.unref?.()
    child.stdout?.on('data', (d) => { stdout += String(d) })
    child.stderr?.on('data', (d) => { stderr += String(d) })
    child.on('error', (err) => { clearTimeout(timer); finish({ ok: false, reason: errText(err) }) })
    child.on('close', () => {
      clearTimeout(timer)
      try {
        const txt = out + '.txt'
        if (existsSync(txt)) {
          const body = readFileSync(txt, 'utf8').replace(/\s+/g, ' ').trim()
          if (body) return finish({ ok: true, text: body.slice(0, 400) })
        }
      } catch { /* ignore */ }
      const body = stdout.replace(/\s+/g, ' ').trim()
      if (body) return finish({ ok: true, text: body.slice(0, 400) })
      finish({ ok: false, reason: (stderr || '没有输出').slice(0, 160) })
    })
  })
}
