/**
 * 本地 ComfyUI 生图（SD1.5 anything-v5）
 *
 * 角色设定参考社区二创「大肥鱼/鲸鱼娘」（CC BY-NC-SA 4.0，非商业用途）：
 *   大头短身（约 2.5 头身）、圆脸、深蓝紫→浅蓝渐变波浪长发、一根呆毛、蓝瞳、
 *   白色褶边头箍 + 蓝色小蝴蝶结、深蓝白长袖女仆裙、蓝色椭圆胸针、白色围裙上的鲸鱼图案、
 *   侧部鲸鳍状特征、白袜深蓝圆头鞋、鲸尾从身后伸出；清楚深色轮廓 + 柔和赛璐璐阴影。
 *   注意：饭碗不是固定道具；避免写实鼻梁、细腰长腿、过多碎发、荧光蓝、满身金饰。
 */
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { dirs, audit } from './store.js'
import { loadConfig } from './config.js'

export const BASE_PROMPT = 'masterpiece, best quality, 1girl, chibi, big head, 2.5 head proportion, round face, very long wavy hair, dark blue to light blue gradient hair, single ahoge, blue eyes, white frilled headband, small blue hair bow, blue whale-hood cloak with whale eyes on the hood, white fluffy trim, dark blue winter coat with snowflake and wave patterns, deep blue bow brooch, blue and white pom-pom hair ties, dark blue boots, whale tail behind body, cel shading, clean dark outline, soft colors'
export const BASE_NEGATIVE = '(worst quality, low quality:1.4), realistic, sharp nose, slim waist, long legs, many stray hair strands, neon blue, excessive gold ornaments, text, watermark, signature, extra limbs, bad hands'

const CHAR_RE = /(大肥鱼|鲸鱼娘|肥鱼|鱼鱼|鲸鱼)/

/**
 * 提示词组装：
 *   character=lock → 永远套角色底子
 *   character=free → 只按用户描述
 *   character=auto（默认）→ 用户提到了她（大肥鱼/鲸鱼娘…）才套角色底子
 */
export function buildDrawPrompt(userText, { character = 'auto' } = {}) {
  const extra = String(userText ?? '').trim().replace(/\s+/g, ' ').slice(0, 300)
  if (character === 'free') return extra
  if (character === 'lock') return extra ? BASE_PROMPT + ', ' + extra : BASE_PROMPT
  return extra && CHAR_RE.test(extra) ? BASE_PROMPT + ', ' + extra : extra
}

/** 是否直接出图（不进确认）：! 前缀 / confirmMode=off / smart 且短而明确 */
export function directMode(prompt, mode = 'always') {
  const p = String(prompt ?? '').trim()
  if (p.startsWith('!')) return { direct: true, why: 'bang' }
  if (mode === 'off') return { direct: true, why: 'off' }
  if (mode === 'smart' && p.length > 0 && p.length <= 30 && !/(参考|改成|像|风格|样子|模仿)/.test(p)) return { direct: true, why: 'smart' }
  return { direct: false, why: '' }
}

const BASE = 'http://127.0.0.1:8188'

async function up(timeoutMs = 3000) {
  try {
    const r = await fetch(BASE + '/system_stats', { signal: AbortSignal.timeout(timeoutMs) })
    return r.ok
  } catch { return false }
}

/** 生图前停语音（显存互斥） */
export function stopVoice() {
  try {
    const c = spawn('wsl', ['-d', 'Ubuntu', '-e', 'bash', '-lc', 'pkill -f tts_daemon.py || true'], { windowsHide: true, stdio: 'ignore', detached: true })
    c.unref?.()
    return true
  } catch { return false }
}

async function ensureComfy(cfg, logger = console) {
  if (await up()) return true
  const root = String(cfg?.draw?.comfyRoot || 'D:\\ComfyUI')
  const py = join(root, 'python', 'python.exe')
  const main = join(root, 'ComfyUI', 'main.py')
  if (!existsSync(py) || !existsSync(main)) return false
  logger?.info?.('[qqbot-refine] 启动 ComfyUI…')
  try {
    const c = spawn(py, ['-s', main, '--port', '8188', '--listen', '127.0.0.1'], { cwd: join(root, 'ComfyUI'), windowsHide: true, stdio: 'ignore', detached: true })
    c.unref?.()
  } catch { return false }
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 2000))
    if (await up(2000)) return true
  }
  return false
}

const WF_PATH = fileURLToPath(new URL('../assets/comfyui/sd15_txt2img.json', import.meta.url))
function workflowPath(name = 'sd15_txt2img.json') { return fileURLToPath(new URL('../assets/comfyui/' + name, import.meta.url)) }

/** 生成一张图，返回本地路径 */

/** 把参考图上传到 ComfyUI（/upload/image），返回文件名 */
async function uploadImage(buf, name) {
  try {
    const form = new FormData()
    form.append('image', new Blob([buf], { type: 'image/png' }), name)
    form.append('overwrite', 'true')
    const r = await fetch(BASE + '/upload/image', { method: 'POST', body: form, signal: AbortSignal.timeout(30000) })
    if (!r.ok) return null
    const j = await r.json()
    return j?.name ? (j.subfolder ? j.subfolder + '/' + j.name : j.name) : null
  } catch { return null }
}

/** 取参考图字节：本地路径或 http(s) URL */
async function readRefBytes(ref) {
  const s = String(ref || '')
  if (!s) return null
  try {
    if (/^https?:/i.test(s)) {
      const r = await fetch(s, { signal: AbortSignal.timeout(20000) })
      if (!r.ok) return null
      return Buffer.from(await r.arrayBuffer())
    }
    const p = s.replace(/^file:\/\/\//, '')
    if (!existsSync(p)) return null
    return readFileSync(p)
  } catch { return null }
}
/** 画完释放 ComfyUI 显存（下次画会重新加载模型） */
/** 探活：ComfyUI 是否在跑 */
export async function pingComfy(cfg) {
  const base = String(cfg && cfg.draw && cfg.draw.serviceUrl ? cfg.draw.serviceUrl : BASE).replace(/\/$/, '')
  try {
    const r = await fetch(base + '/system_stats', { signal: AbortSignal.timeout(5000) })
    return { ok: r.ok, url: base }
  } catch (e) { return { ok: false, url: base, error: String(e?.message ?? e).slice(0, 80) } }
}

export async function freeComfy(cfg) {
  const base = String(cfg && cfg.draw && cfg.draw.serviceUrl ? cfg.draw.serviceUrl : BASE).replace(/\/$/, '')
  try {
    const r = await fetch(base + '/free', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ unload_models: true, free_memory: true }), signal: AbortSignal.timeout(8000) })
    return r.ok
  } catch { return false }
}

export async function generate(cfg, userText, opts = {}, logger = console) {
  const d = cfg?.draw ?? {}
  const base = String(d.serviceUrl || BASE).replace(/\/$/, '')
  if (d.enabled === false) return { ok: false, error: '生图没开（draw.enabled）' }
  stopVoice()
  if (!(await ensureComfy(cfg, logger))) return { ok: false, error: 'ComfyUI 起不来（检查 D:\\ComfyUI）' }
  // 有参考图 → 图生图；没有 → 文生图
  let wf
  const refRaw = opts?.ref || (typeof opts === 'string' ? opts : '')
  const refBuf = refRaw ? await readRefBytes(refRaw) : null
  const uploaded = refBuf ? await uploadImage(refBuf, 'ref-' + Date.now() + '.png') : null
  const wfFile = uploaded ? 'sd15_img2img.json' : 'sd15_txt2img.json'
  try { wf = JSON.parse(readFileSync(workflowPath(wfFile), 'utf8')) } catch (e) { return { ok: false, error: '读不到工作流：' + String(e?.message ?? e).slice(0, 80) } }
  const width = Math.max(256, Math.min(1024, Number(d.width ?? 512)))
  const height = Math.max(256, Math.min(1024, Number(d.height ?? 768)))
  const charMode = String(d.character ?? 'auto')
  if (uploaded) { wf['1'].inputs.image = uploaded; wf['3'].inputs.text = buildDrawPrompt(userText, { character: charMode }); wf['6'].inputs.denoise = Math.max(0.2, Math.min(0.9, Number(d.refDenoise ?? 0.6))) } else { wf['2'].inputs.text = buildDrawPrompt(userText, { character: charMode }) }
  if (!uploaded) wf['3'].inputs.text = String(d.negative || BASE_NEGATIVE)
  if (!uploaded) { wf['4'].inputs.width = width; wf['4'].inputs.height = height }
  wf['5'].inputs.steps = Math.max(8, Math.min(50, Number(d.steps ?? 22)))
  wf['5'].inputs.seed = Math.floor(Math.random() * 2147483000)
  let promptId = ''
  try {
    const r = await fetch(base + '/prompt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: wf, client_id: 'qqbot-refine' }), signal: AbortSignal.timeout(30000) })
    if (!r.ok) return { ok: false, error: '提交失败 HTTP ' + r.status }
    const j = await r.json()
    promptId = j.prompt_id || ''
  } catch (e) { return { ok: false, error: '提交失败：' + String(e?.message ?? e).slice(0, 100) } }
  if (!promptId) return { ok: false, error: '没有拿到 prompt_id' }
  const deadline = Date.now() + Math.max(30000, Number(d.timeoutMs ?? 240000))
  let img = null
  while (Date.now() < deadline && !img) {
    await new Promise((r) => setTimeout(r, 1200))
    try {
      const h = await (await fetch(base + '/history/' + promptId, { signal: AbortSignal.timeout(10000) })).json()
      const rec = h?.[promptId]
      if (!rec) continue
      const st = rec.status?.status_str
      if (st === 'error') return { ok: false, error: '执行失败（看 ComfyUI 日志）' }
      for (const k of Object.keys(rec.outputs || {})) {
        const o = rec.outputs[k]
        if (o?.images?.length) { img = o.images[0]; break }
      }
    } catch { /* 继续轮询 */ }
  }
  if (!img) return { ok: false, error: '生成超时' }
  try {
    const q = '/view?filename=' + encodeURIComponent(img.filename) + '&subfolder=' + encodeURIComponent(img.subfolder || '') + '&type=' + encodeURIComponent(img.type || 'output')
    const r = await fetch(base + q, { signal: AbortSignal.timeout(60000) })
    if (!r.ok) return { ok: false, error: '下载图片失败 HTTP ' + r.status }
    const buf = Buffer.from(await r.arrayBuffer())
    const outDir = dirs.generated || dirs.tmp
    mkdirSync(outDir, { recursive: true })
    const p = join(outDir, 'draw-' + Date.now() + '.png')
    writeFileSync(p, buf)
    audit('draw.ok', { bytes: buf.length, w: width, h: height, ref: !!uploaded, prompt: String(userText ?? '').slice(0, 60) })
    if (d.freeAfter !== false) { try { void freeComfy(cfg) } catch { /* ignore */ } }
    return { ok: true, path: p, bytes: buf.length }
  } catch (e) { return { ok: false, error: '下载失败：' + String(e?.message ?? e).slice(0, 100) } }
}

// ── 先搜一下再画：给用户看「我理解成什么」，不是把搜索结果塞进提示词 ──
export async function searchSnippets(query, limit = 3) {
  const q = String(query ?? '').trim()
  if (!q) return []
  try {
    const r = await fetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q.slice(0, 80)), {
      headers: { 'user-agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(12000),
    })
    if (!r.ok) return []
    const html = await r.text()
    const out = []
    const re = /result__snippet[^>]*>([\s\S]{0,400}?)<\/a>/g
    let m
    while ((m = re.exec(html)) && out.length < limit) {
      const txt = m[1].replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim()
      if (txt && txt.length > 8) out.push(txt.slice(0, 120))
    }
    return out
  } catch { return [] }
}

// ── 先问后画：草稿 → 确认 → 生成 ──
const pending = new Map()
export function keyOf(peer, sender) { return String(peer) + ':' + String(sender) }
export function putPending(peer, sender, draft, ttlSec = 90) {
  const key = keyOf(peer, sender)
  pending.set(key, { ...draft, at: Date.now(), ttl: Math.max(20, Number(ttlSec) || 90) })
  if (pending.size > 200) { const k = pending.keys().next().value; pending.delete(k) }
  return pending.get(key)
}
export function getPending(peer, sender) {
  const key = keyOf(peer, sender)
  const p = pending.get(key)
  if (!p) return null
  if (Date.now() - p.at > p.ttl * 1000) { pending.delete(key); return null }
  return p
}
export function dropPending(peer, sender) { pending.delete(keyOf(peer, sender)) }

const YES = /^(画吧|好|好的|嗯|嗯哼|可以|行|确认|就这样|ok|okay|draw|yes)[!！。.~～]*$/i
export function parseConfirm(text) {
  const s = String(text ?? '').trim()
  if (!s) return { kind: 'none' }
  if (YES.test(s)) return { kind: 'yes' }
  const m = s.match(/^(改|换成|加|去掉|调整)[：:\s]*(.{1,150})$/s)
  if (m) return { kind: 'modify', text: m[2].trim() }
  return { kind: 'none' }
}

/** 生成一段「我准备这样画」的确认文案 */
export function draftMessage(draft, snippets) {
  const lines = ['我准备这样画：', '· ' + (draft.userText || '（只画角色基准）'), draft.ref ? '· 用你发的图当参考（图生图，保留构图/配色）' : '· 角色基准（蓝发呆毛女仆裙鲸尾）+ ' + (draft.width || 512) + '×' + (draft.height || 768) + ' / ' + (draft.steps || 22) + ' 步']
  if (!draft.ref && snippets && snippets.length) lines.push('参考：' + snippets[0].slice(0, 80))
  lines.push('回「' + '画吧」确认，发「改：……」（例如 改：换成白色连衣裙）改描述，' + Math.round((draft.ttl || 90)) + ' 秒内有效。')
  return lines.join('\n')
}
