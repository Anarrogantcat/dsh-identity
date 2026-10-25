/**
 * 表情包：远程图库（fisharchive，CC BY-NC-SA 4.0，仅个人非商用）+ 群内收集 + 自生成
 * 图库索引：stickers/index.json；文件：stickers/{remote,collected,generated}
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs'
import { join, extname } from 'node:path'
import { readJson, writeJson, dirs, sha, audit } from './store.js'
import { dayCountPass, dedupePass, state } from './state.js'

const INDEX_PATH = join(dirs.stickers, 'index.json')

export const MOOD_MAP = {
  开心: ['搞笑', '开心', '得意', '庆祝', '游戏'],
  害羞: ['卖萌', '害羞'],
  无语: ['无语', '敷衍', '摸鱼'],
  生气: ['生气', '拒绝'],
  委屈: ['委屈', '难过', '疑惑'],
  惊讶: ['震惊', '疑惑'],
  吃饭: ['吃饭'],
  晚安: ['睡觉'],
  加油: ['加油', '学习', '工作'],
  打招呼: ['打招呼', '出游', '运动', '购物'],
}

export function moodsFromTags(tags = []) {
  const out = new Set()
  for (const [mood, list] of Object.entries(MOOD_MAP)) {
    if (tags.some((t) => list.includes(t))) out.add(mood)
  }
  return [...out]
}

export function loadIndex() {
  return readJson(INDEX_PATH, { version: 1, syncedAt: null, items: [] })
}
export function saveIndex(idx) {
  writeJson(INDEX_PATH, idx)
}

/** 拉远程索引（只存元数据，图片按需取） */
export function sourceList(cfg) {
  const list = Array.isArray(cfg?.sticker?.remoteSources) ? cfg.sticker.remoteSources.filter(Boolean) : []
  if (list.length) return list
  if (cfg?.sticker?.remoteSource) return [cfg.sticker.remoteSource]
  return []
}

function hostOf(url) {
  try { return new URL(url).host } catch { return 'unknown' }
}

/** 多源同步：逐个源拉索引，合并进同一份图库（按图片 URL 去重） */
export async function syncRemote(cfg, logger = console) {
  const sources = sourceList(cfg)
  if (!sources.length) return { ok: false, error: '未配置远程图库 URL' }
  const idx = loadIndex()
  const byId = new Map(idx.items.map((i) => [i.id, i]))
  const perSource = []
  let added = 0

  for (const url of sources) {
    const host = hostOf(url)
    try {
      const res = await fetch(url, { headers: { 'user-agent': 'dsh-qqbot-refine/0.2' } })
      if (!res.ok) { perSource.push({ url, host, ok: false, error: 'HTTP ' + res.status }); continue }
      const data = await res.json()
      const list = Array.isArray(data?.stickers) ? data.stickers : []
      let n = 0
      for (const s of list) {
        const url0 = s.original ?? s.large ?? s.preview
        if (!url0) continue
        const id = sha(url0, 16)
        if (byId.has(id)) continue
        byId.set(id, {
          id,
          url: url0,
          large: s.large ?? null,
          alt: s.alt ?? '',
          tags: Array.isArray(s.tags) ? s.tags : [],
          moods: moodsFromTags(s.tags ?? []),
          source: host,
          license: data?.license?.name ?? data?.license ?? '',
          addedAt: new Date().toISOString(),
          path: null,
        })
        n += 1
      }
      added += n
      perSource.push({ url, host, ok: true, added: n, count: list.length })
    } catch (err) {
      perSource.push({ url, host, ok: false, error: String(err?.message ?? err) })
    }
  }

  idx.items = [...byId.values()]
  idx.syncedAt = new Date().toISOString()
  idx.sources = perSource
  idx.sourceUrl = sources[0]
  saveIndex(idx)
  logger.info?.(`[qqbot-refine] 图库同步：${sources.length} 个源，新增 ${added}，共 ${idx.items.length}`)
  audit('sticker.sync', { added, total: idx.items.length, sources: sources.length })
  return { ok: true, added, total: idx.items.length, sources: perSource }
}

/** 按 mood 挑一张（含去重 + 每日配额） */
export function pickSticker(cfg, groupId, mood) {
  const idx = loadIndex()
  if (!idx.items.length) return null
  const pool = idx.items.filter((i) => (i.moods ?? []).includes(mood) || (i.tags ?? []).includes(mood))
  if (!pool.length) return null
  const shuffled = [...pool].sort(() => Math.random() - 0.5)
  for (const item of shuffled) {
    if (!dedupePass(item.id, cfg.sticker.dedupeHours)) continue
    if (!dayCountPass(`sticker:send:${groupId}`, cfg.sticker.perGroupDay)) return null
    return item
  }
  return null
}

async function ensureLocal(item) {
  if (item.path && existsSync(item.path)) return item.path
  const url = item.large ?? item.url
  const res = await fetch(url, { headers: { 'user-agent': 'dsh-qqbot-refine/0.2' } })
  if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const ext = (new URL(url).pathname.match(/\.(png|jpg|jpeg|gif|webp)$/i)?.[1] ?? 'png').toLowerCase()
  const p = join(dirs.remote, `${item.id}.${ext}`)
  writeFileSync(p, buf)
  const idx = loadIndex()
  const it = idx.items.find((x) => x.id === item.id)
  if (it) { it.path = p; saveIndex(idx) }
  return p
}

/** 发送一张表情：优先直链（QQ 服务端拉取），失败回落本地下载 */
export async function sendSticker(bot, target, item) {
  if (!item) return false
  if (item.source === 'fisharchive' && item.url) {
    try {
      await bot.sendImage(target, { url: item.large ?? item.url })
      return true
    } catch { /* 回落本地 */ }
  }
  const local = item.path ?? (await ensureLocal(item))
  await bot.sendImage(target, { localPath: local })
  return true
}

/** 像不像一张「表情」：太大/太宽的都是截图，别塞进表情库 */
export async function looksLikeSticker(buf, maxPx = 640) {
  try {
    const { getSharp } = await import('./card.js')
    const sharp = await getSharp()
    if (!sharp) return true // 没有 sharp 就不拦
    const meta = await sharp(buf).metadata()
    const w = Number(meta.width ?? 0)
    const h = Number(meta.height ?? 0)
    if (!w || !h) return false
    if (Math.max(w, h) > maxPx) return false
    const ratio = Math.max(w, h) / Math.min(w, h)
    if (ratio > 2.4) return false
    return true
  } catch { return true }
}

/** 群内收集（图片附件）：只存 hash 名，不保留发送者 */
export async function collectSticker(cfg, groupId, imageUrl) {
  if (!cfg.sticker.collectEnabled) return null
  if (!dayCountPass(`sticker:collect:${groupId}`, cfg.sticker.collectPerGroupDay)) return null
  try {
    const res = await fetch(imageUrl, { headers: { 'user-agent': 'dsh-qqbot-refine/0.2' } })
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > 2 * 1024 * 1024) return null
    if (!(await looksLikeSticker(buf, Number(cfg.sticker.collectMaxPx ?? 640)))) return null
    const id = sha(buf, 16)
    const idx = loadIndex()
    if (idx.items.some((i) => i.id === id)) return null
    const ext = (imageUrl.match(/\.(png|jpg|jpeg|gif|webp)$/i)?.[1] ?? 'png').toLowerCase()
    const p = join(dirs.collected, `${id}.${ext}`)
    writeFileSync(p, buf)
    const item = {
      id, url: null, alt: '', tags: [], moods: [], source: 'collected', path: p,
      addedAt: new Date().toISOString(),
      ttlAt: new Date(Date.now() + cfg.sticker.collectTtlDays * 86400000).toISOString(),
    }
    idx.items.push(item)
    saveIndex(idx)
    return item
  } catch { return null }
}

/** 过期清理（收集图 30 天） */
export function cleanExpired(cfg) {
  const idx = loadIndex()
  const now = Date.now()
  const keep = []
  let removed = 0
  for (const i of idx.items) {
    if (i.ttlAt && Date.parse(i.ttlAt) < now) {
      if (i.path) try { unlinkSync(i.path) } catch { /* ignore */ }
      removed += 1
      continue
    }
    keep.push(i)
  }
  if (removed) { idx.items = keep; saveIndex(idx) }
  return removed
}

/**
 * 自生成：OpenAI 兼容 /images/generations（不占用 DSH token，花的是图像 API 的额度）
 */
export async function generateSticker(cfg, groupId, mood, prompt) {
  const prov = cfg.sticker.genProvider ?? {}
  if (!prov.baseUrl || !prov.apiKey) return { ok: false, error: '未配置图像 provider' }
  if (!dayCountPass(`sticker:gen:${groupId}`, cfg.sticker.genPerGroupDay)) {
    return { ok: false, error: '本群今日生成额度已用完' }
  }
  const bad = /(真人|照片|肖像|明星|身份证|未成年)/i
  if (bad.test(prompt)) return { ok: false, error: '提示词命中枢保护规则' }
  const body = {
    model: prov.model || 'flux-schnell',
    prompt: `${prompt}，表情包风格，简洁背景，无文字`,
    n: 1,
    size: prov.size || '512x512',
    response_format: 'b64_json',
  }
  const res = await fetch(`${prov.baseUrl.replace(/\/$/, '')}/images/generations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${prov.apiKey}` },
    body: JSON.stringify(body),
  })
  if (!res.ok) return { ok: false, error: `生成失败 HTTP ${res.status}` }
  const data = await res.json()
  let buf = null
  const b64 = data?.data?.[0]?.b64_json
  const url = data?.data?.[0]?.url
  if (b64) buf = Buffer.from(b64, 'base64')
  else if (url) buf = Buffer.from(await (await fetch(url)).arrayBuffer())
  if (!buf) return { ok: false, error: '生成结果为空' }
  const id = sha(buf, 16)
  const p = join(dirs.generated, `${id}.png`)
  mkdirSync(dirs.generated, { recursive: true })
  writeFileSync(p, buf)
  const idx = loadIndex()
  idx.items.push({ id, url: null, alt: prompt, tags: [mood], moods: [mood], source: 'generated', path: p, addedAt: new Date().toISOString() })
  saveIndex(idx)
  return { ok: true, item: idx.items[idx.items.length - 1] }
}

export function stats() {
  const idx = loadIndex()
  const by = {}
  for (const i of idx.items) by[i.source ?? 'unknown'] = (by[i.source ?? 'unknown'] ?? 0) + 1
  return { total: idx.items.length, by, syncedAt: idx.syncedAt ?? null }
}

export { INDEX_PATH }
