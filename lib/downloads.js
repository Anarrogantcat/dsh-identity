/**
 * 语音资源下载（whisper 模型 / ffmpeg）——大文件，默认落到数据目录，可整体挪盘
 *
 * 为什么单独做一块：whisper-small 约 466MB、ffmpeg essentials 约 80MB，C 盘吃不住；
 * 这些文件只影响「语音转写」，不装也能聊（入站语音会留 [语音] 占位）。
 *
 * 落地位置优先级： paths.downloadsDir > <数据目录>/downloads
 * 数据目录本身可挪盘：环境变量 QQBOT_REFINE_HOME 或默认目录下的 .data-path 指针（见 scripts/move-data.ps1）
 */
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join, basename } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { dirs } from './store.js'
import { loadConfig, STORE_DIR } from './config.js'
import { audit } from './store.js'

/** 可下载资源清单（id 稳定；url 用官方发布地址） */
export const MANIFEST = [
  {
    id: 'whisper-model-small',
    name: 'Whisper 模型（small，中文识别够用）',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin',
    file: 'ggml-small.bin',
    sizeMB: 466,
    kind: 'model',
    note: '466MB；转写质量好，占地方',
  },
  {
    id: 'whisper-model-base',
    name: 'Whisper 模型（base，省地方）',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin',
    file: 'ggml-base.bin',
    sizeMB: 142,
    kind: 'model',
    note: '142MB；够听清日常对话，错字略多',
  },
  {
    id: 'ffmpeg-essentials',
    name: 'FFmpeg（解压后放进 PATH 或本插件 bin）',
    url: 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip',
    file: 'ffmpeg-release-essentials.zip',
    sizeMB: 80,
    kind: 'tool',
    note: '约 80MB；语音要转 wav、视频要转码时用',
  },
]

const byId = new Map(MANIFEST.map((x) => [x.id, x]))
const errText = (e) => String(e?.message ?? e).slice(0, 160)

/** 下载落地目录（可自定义，默认数据目录下的 downloads/） */
export function downloadsDir(cfg = loadConfig()) {
  const custom = String(cfg?.paths?.downloadsDir ?? '').trim()
  return custom || join(dirs.downloads)
}

export function modelPath(id, cfg = loadConfig()) {
  const item = byId.get(id)
  if (!item) return ''
  return join(downloadsDir(cfg), item.file)
}

/** 状态：每个资源在不在、多大 */
export function assetStatus(cfg = loadConfig()) {
  const root = downloadsDir(cfg)
  return {
    root,
    dataDir: STORE_DIR,
    items: MANIFEST.map((x) => {
      const p = join(root, x.file)
      let bytes = 0
      try { bytes = existsSync(p) ? statSync(p).size : 0 } catch { bytes = 0 }
      return {
        id: x.id, name: x.name, file: x.file, url: x.url, sizeMB: x.sizeMB, kind: x.kind, note: x.note,
        path: p,
        installed: bytes > 0,
        bytes,
        gotMB: bytes ? Number((bytes / 1048576).toFixed(1)) : 0,
        looksComplete: bytes > 0 && x.sizeMB > 0 ? bytes >= x.sizeMB * 1048576 * 0.9 : bytes > 0,
      }
    }),
  }
}

/** 下载进度（模块内，面板轮询用） */
const progress = new Map()

export function progressOf(id) {
  return id ? (progress.get(id) ?? null) : Object.fromEntries(progress)
}

/** 通用下载：url → 目标文件（先写 .part 再改名，失败不留半截文件） */
export async function downloadUrl(url, dest, { timeoutMs = 0, onProgress = null } = {}) {
  if (!/^https?:\/\//i.test(String(url ?? ''))) return { ok: false, error: '只支持 http(s) 地址' }
  mkdirSync(join(dest, '..'), { recursive: true })
  const tmp = dest + '.part'
  let completed = false
  try {
    const signal = timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined
    const res = await fetch(url, { redirect: 'follow', signal })
    if (!res.ok || !res.body) return { ok: false, error: 'HTTP ' + res.status }
    const total = Number(res.headers.get('content-length') ?? 0) || 0
    const out = createWriteStream(tmp)
    let got = 0
    const t0 = Date.now()
    let lastCb = 0
    try {
      for await (const chunk of Readable.fromWeb(res.body)) {
        got += chunk.length
        if (!out.write(chunk)) await new Promise((r) => out.once('drain', r))
        const now = Date.now()
        if (onProgress && now - lastCb > 200) {
          lastCb = now
          onProgress({ got, total, speedBps: got / Math.max(0.5, (now - t0) / 1000) })
        }
      }
    } finally {
      await new Promise((r) => out.end(r))
    }
    renameSync(tmp, dest)
    completed = true
    if (onProgress) onProgress({ got, total: total || got, speedBps: got / Math.max(0.5, (Date.now() - t0) / 1000) })
    let bytes = got
    try { bytes = statSync(dest).size } catch { /* ignore */ }
    return { ok: true, path: dest, bytes }
  } catch (err) {
    return { ok: false, error: errText(err) }
  } finally {
    if (!completed) { try { rmSync(tmp, { force: true }) } catch { /* ignore */ } }
  }
}
/** 按清单下载一个资源（异步推进度；调用方不必等） */
export async function downloadAsset(id, cfg = loadConfig(), logger = console) {
  const item = byId.get(String(id ?? ''))
  if (!item) return { ok: false, error: '未知资源：' + id }
  const root = downloadsDir(cfg)
  const dest = join(root, item.file)
  const state = { id: item.id, file: item.file, url: item.url, dest, startedAt: Date.now(), doneAt: 0, ok: null, error: '', bytes: 0, got: 0, total: 0, pct: 0, speedBps: 0 }
  progress.set(item.id, state)
  try {
    const r = await downloadUrl(item.url, dest, { onProgress: (p) => { state.got = p.got; state.total = p.total; state.pct = p.total ? Math.min(99, Math.round((p.got / p.total) * 100)) : 0; state.speedBps = p.speedBps || 0 } })
    state.doneAt = Date.now()
    state.ok = !!r.ok
    state.error = r.error ?? ''
    state.bytes = r.bytes ?? 0
    state.pct = r.ok ? 100 : state.pct
    if (r.ok) {
      audit('assets.download', { id: item.id, mb: Number(((r.bytes || 0) / 1048576).toFixed(1)), dest })
      logger.info?.('[qqbot-refine] 资源已下载：' + item.name + ' → ' + dest)
    } else {
      logger.warn?.('[qqbot-refine] 资源下载失败：' + item.name + '：' + r.error)
    }
    return { ok: !!r.ok, path: dest, bytes: r.bytes ?? 0, error: r.error ?? '' }
  } catch (err) {
    state.doneAt = Date.now()
    state.ok = false
    state.error = errText(err)
    return { ok: false, error: state.error }
  }
}

/** 删掉已下载的资源（挪盘前/重下时用） */
export function removeAsset(id, cfg = loadConfig()) {
  const item = byId.get(String(id ?? ''))
  if (!item) return { ok: false, error: '未知资源：' + id }
  const p = join(downloadsDir(cfg), item.file)
  try { rmSync(p, { force: true }); progress.delete(item.id); return { ok: true, removed: p } } catch (err) { return { ok: false, error: errText(err) } }
}

/**
 * 自动拼一条 STT 命令（模型已下载、whisper-cli 在 PATH 里时才有意义）
 * 只填空着的 stt.command，不覆盖用户自己写的
 */
export function sttAutoCommand(cfg = loadConfig()) {
  const small = modelPath('whisper-model-small', cfg)
  const base = modelPath('whisper-model-base', cfg)
  const model = existsSync(small) ? small : (existsSync(base) ? base : '')
  if (!model) return ''
  return 'whisper-cli -m "' + model + '" -f {file} -otxt -of {out}'
}

export function downloadsStats() {
  const st = assetStatus()
  return {
    root: st.root,
    installed: st.items.filter((x) => x.installed).length,
    total: st.items.length,
    items: st.items.map((x) => ({ id: x.id, installed: x.installed, gotMB: x.gotMB })),
    progress: progressOf(),
  }
}
