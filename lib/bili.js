/** B站：WBI 签名 + 视频信息 + 智能降画质 + 截取 + 动态推送 */
import { writeFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { dirs, sha } from './store.js'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36'
const MIXIN_TAB = [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52]
const QN_LIST = [
  { qn: 80, h: 1080 }, { qn: 64, h: 720 }, { qn: 32, h: 480 }, { qn: 16, h: 360 },
]

let wbiCache = { at: 0, imgKey: '', subKey: '' }

function cookieHeader(cookie) {
  return cookie ? { cookie } : {}
}

async function biliGet(path, cookie, extra = {}) {
  const res = await fetch(`https://api.bilibili.com${path}`, {
    headers: { 'user-agent': UA, referer: 'https://www.bilibili.com/', ...cookieHeader(cookie), ...extra },
  })
  const data = await res.json().catch(() => null)
  if (!res.ok || !data) throw new Error(`B站接口失败 HTTP ${res.status}`)
  if (data.code !== 0) throw new Error(`B站接口返回 ${data.code}: ${data.message ?? ''}`)
  return data.data
}

async function wbiKeys(cookie) {
  if (Date.now() - wbiCache.at < 3600_000 && wbiCache.imgKey) return wbiCache
  const data = await biliGet('/x/web-interface/nav', cookie)
  const img = data?.wbi_img?.img_url ?? ''
  const sub = data?.wbi_img?.sub_url ?? ''
  const pick = (u) => u.slice(u.lastIndexOf('/') + 1, u.lastIndexOf('.'))
  wbiCache = { at: Date.now(), imgKey: pick(img), subKey: pick(sub) }
  return wbiCache
}

function md5(s) {
  return createHash('md5').update(s).digest('hex')
}

function mixinKey(imgKey, subKey) {
  const raw = imgKey + subKey
  return MIXIN_TAB.map((i) => raw[i] ?? '').join('').slice(0, 32)
}

/** 给参数签名（wts + w_rid） */
export async function signParams(params, cookie) {
  const { imgKey, subKey } = await wbiKeys(cookie)
  const mk = mixinKey(imgKey, subKey)
  const p = { ...params, wts: Math.floor(Date.now() / 1000) }
  const query = Object.keys(p).sort().map((k) => {
    const v = String(p[k]).replace(/[!'()*]/g, '')
    return `${encodeURIComponent(k)}=${encodeURIComponent(v)}`
  }).join('&')
  return `${query}&w_rid=${md5(query + mk)}`
}

// ── 链接解析 ──
export function extractBili(text) {
  const s = String(text ?? '')
  const bv = s.match(/(BV[1-9A-Za-z]{10})/)
  const av = s.match(/\/video\/av(\d+)/)
  const cv = s.match(/\/read\/cv(\d+)/)
  const dyn = s.match(/(?:t\.bilibili\.com|dynamic)\/(\d{8,})/)
  const live = s.match(/live\.bilibili\.com\/(\d+)/)
  const short = s.match(/(?:b23\.tv|bili2233\.cn)\/([A-Za-z0-9]+)/)
  if (bv) return { kind: 'video', bvid: bv[1] }
  if (av) return { kind: 'video', aid: Number(av[1]) }
  if (cv) return { kind: 'article', id: cv[1] }
  if (dyn) return { kind: 'dynamic', id: dyn[1] }
  if (live) return { kind: 'live', id: live[1] }
  if (short) return { kind: 'short', code: short[1] }
  return null
}

export async function expandShort(code) {
  const res = await fetch(`https://b23.tv/${code}`, { redirect: 'manual', headers: { 'user-agent': UA } })
  const loc = res.headers.get('location') ?? ''
  return loc
}

export async function videoInfo({ bvid, aid }, cookie) {
  const q = bvid ? `bvid=${bvid}` : `aid=${aid}`
  const d = await biliGet(`/x/web-interface/view?${q}`, cookie)
  return {
    bvid: d.bvid, aid: d.aid, cid: d.pages?.[0]?.cid ?? d.cid,
    title: d.title, cover: d.pic, duration: d.duration,
    owner: d.owner?.name ?? '', view: d.stat?.view ?? 0, desc: d.desc ?? '',
  }
}

/** 智能分辨率：在体积预算内选最高画质 */
export async function smartResolution(info, cfg) {
  const budget = (cfg.bili.sizeBudgetMB ?? 30) * 1024 * 1024
  const minH = cfg.bili.minHeight ?? 360
  const tried = []
  for (const q of QN_LIST) {
    if (q.h < minH) break
    try {
      const query = await signParams({ bvid: info.bvid, cid: info.cid, qn: q.qn, fnval: 16, fourk: 0 }, cfg.bili.cookie)
      const d = await biliGet(`/x/player/wbi/playurl?${query}`, cfg.bili.cookie)
      const size = d?.durl?.[0]?.size ?? d?.dash?.video?.reduce((a, v) => a + (v.size ?? 0), 0) ?? 0
      tried.push({ qn: q.qn, h: q.h, size })
      if (size > 0 && size <= budget) return { ...q, size, data: d }
    } catch { /* 换下一档 */ }
  }
  return { tried, size: 0 }
}

export function formatCard(info) {
  const mm = Math.round((info.duration ?? 0) / 60)
  return [
    `**${info.title}**`,
    `UP：${info.owner} ｜ 时长 ${mm} 分钟 ｜ 播放 ${info.view}`,
    info.desc ? info.desc.slice(0, 120).replace(/\s+/g, ' ') : '',
    `https://www.bilibili.com/video/${info.bvid}`,
  ].filter(Boolean).join('\n')
}

// ── 截取 / 下载（依赖外部工具，缺失自动降级）──
export function findTool(name) {
  try {
    const { execFileSync } = require('node:child_process')
    const out = execFileSync('where', [name], { encoding: 'utf8' }).split(/\r?\n/)[0].trim()
    return out || null
  } catch { return null }
}

async function downloadTo(url, file) {
  const res = await fetch(url, { headers: { 'user-agent': UA, referer: 'https://www.bilibili.com/' } })
  if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  mkdirSync(dirs.tmp, { recursive: true })
  writeFileSync(file, buf)
  return buf.length
}

export async function downloadVideo(cfg, info, pick) {
  const url = pick?.data?.durl?.[0]?.url
  if (!url) return { ok: false, error: '该画质没有直链（可能是 DASH 流）' }
  const file = join(dirs.tmp, `${info.bvid}-${Date.now()}.mp4`)
  const size = await downloadTo(url, file)
  return { ok: true, file, size }
}

export function cleanTmp(cfg) {
  const keep = 24 * 3600 * 1000
  let removed = 0
  try {
    for (const f of readdirSync(dirs.tmp)) {
      const p = join(dirs.tmp, f)
      if (Date.now() - statSync(p).mtimeMs > keep) { unlinkSync(p); removed += 1 }
    }
  } catch { /* ignore */ }
  return removed
}

// ── 动态推送 ──
export async function fetchUserDynamics(mid, cfg) {
  const query = await signParams({ host_mid: mid, timezone_offset: -480, features: 'itemOpusStyle' }, cfg.bili.cookie)
  const d = await biliGet(`/x/polymer/web-dynamic/v1/feed/space?${query}`, cfg.bili.cookie)
  const items = d?.items ?? []
  return items.map((it) => {
    const mod = it.modules?.module_dynamic ?? {}
    const major = mod.major ?? {}
    const text = mod.desc?.text ?? major?.opus?.summary?.text ?? ''
    const pic = major?.opus?.pics?.[0]?.url ?? major?.draw?.items?.[0]?.src ?? null
    return {
      id: it.id_str,
      at: it.modules?.module_author?.pub_ts ?? 0,
      author: it.modules?.module_author?.name ?? '',
      text,
      pic,
      link: `https://t.bilibili.com/${it.id_str}`,
    }
  })
}

/** 卡片数据（走 lib/card.js 的 SVG 渲染，0 token） */
export function biliCardData(info, pick, cfg) {
  const mm = Math.floor((info.duration ?? 0) / 60)
  const ss = String((info.duration ?? 0) % 60).padStart(2, '0')
  const size = pick?.size ? `${(pick.size / 1048576).toFixed(1)} MB` : '未知'
  return {
    title: '📺 B站 · ' + (info.title ?? ''),
    subtitle: `UP：${info.owner ?? '?'} ｜ 时长 ${mm}:${ss} ｜ 播放 ${info.view ?? 0} ｜ 预算 ${cfg.bili.sizeBudgetMB} MB`,
    sections: [
      {
        title: '可选画质',
        rows: [
          { cmd: pick?.h ? `${pick.h}P` : '—', note: pick?.size ? `约 ${size}` : '未取到体积信息' },
          { cmd: '截取', note: cfg.bili.clipEnabled ? `前 ${cfg.bili.clipSeconds} 秒（需 yt-dlp）` : '关闭' },
        ],
      },
      { title: '链接', rows: [{ cmd: `https://www.bilibili.com/video/${info.bvid}`, note: '' }] },
    ],
    footer: '解析与卡片均为 0 token',
  }
}

/** 截取/下载：优先 yt-dlp（支持时间段），失败返回 {ok:false} 由调用方降级 */
export async function clipViaYtDlp(cfg, url, fromSec, seconds, outFile) {
  const ytdlp = findTool('yt-dlp')
  if (!ytdlp) return { ok: false, error: '未安装 yt-dlp' }
  const { spawn } = await import('node:child_process')
  const args = [
    '--no-playlist', '--no-warnings',
    '-f', `best[height<=${cfg.bili.quality ?? 480}]`,
    '--download-sections', `*${fromSec}-${fromSec + seconds}`,
    '-o', outFile, '--force-overwrites', url,
  ]
  return await new Promise((resolve) => {
    const p = spawn(ytdlp, args, { windowsHide: true })
    let err = ''
    p.stderr?.on('data', (d) => { err += d.toString() })
    p.on('error', (e) => resolve({ ok: false, error: e.message }))
    p.on('close', (code) => resolve(code === 0 ? { ok: true, file: outFile } : { ok: false, error: err.slice(0, 200) }))
    setTimeout(() => { try { p.kill() } catch { /* ignore */ } resolve({ ok: false, error: 'timeout' }) }, 180000)
  })
}
