/**
 * B站浏览器能力：专用 Edge + CDP，搜索/打开公开页面，用完就关。
 * 不登录、不点赞、不投币；只读页面文本。
 */
import { spawn, execFileSync } from 'node:child_process'
import { statSync } from 'node:fs'
import { join } from 'node:path'
import { dirs } from './store.js'
import { connectCdp } from './payqr.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const PORT = 9444
const PROFILE = () => join(dirs.root, 'bili-browser')

function edgePath() {
  const pf = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
  const pf64 = process.env.ProgramFiles || 'C:\\Program Files'
  const list = [join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), join(pf64, 'Microsoft', 'Edge', 'Application', 'msedge.exe')]
  return list.find((p) => { try { return statSync(p).isFile() } catch { return false } })
}

function closeBrowser() {
  try {
    const profile = PROFILE()
    const ps = "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'msedge.exe' -and $_.CommandLine -like '*" + profile.replace(/'/g, "''") + "*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
    execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true, timeout: 8000 })
  } catch { /* ignore */ }
}

async function ensure() {
  let c = await connectCdp(PORT, 1500)
  if (c.ok) return c
  const startedByUs = true
  const edge = edgePath()
  if (!edge) return { ok: false, error: '找不到 msedge.exe' }
  spawn(edge, ['--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE(), '--no-first-run', '--no-default-browser-check', '--new-window', 'about:blank'], { detached: true, windowsHide: true, stdio: 'ignore' }).unref?.()
  for (let i = 0; i < 24; i++) { await sleep(500); c = await connectCdp(PORT, 2000); if (c.ok) { c.startedByUs = true; return c } }
  return { ok: false, error: '浏览器没起来', startedByUs }
}

const EXTRACT = `(() => {
  const byBv = new Map();
  const push = (href, title) => {
    const m = String(href || '').match(/\\/video\\/(BV[0-9A-Za-z]+)/);
    const t = String(title || '').replace(/\\s+/g, ' ').trim();
    if (!m || !t || t.length < 4 || /稍后再看|播放|弹幕|评论/.test(t)) return;
    const prev = byBv.get(m[1]);
    if (!prev || t.length > prev.length) byBv.set(m[1], t);
  };
  for (const a of document.querySelectorAll('.bili-video-card__info--tit, a[title][href*="/video/"]')) push(a.href, a.getAttribute('title') || a.textContent);
  for (const a of document.querySelectorAll('a[href*="/video/"]')) push(a.href, a.getAttribute('title') || a.textContent);
  const out = [];
  for (const [bv, title] of byBv) { out.push({ title: title.slice(0, 60), href: 'https://www.bilibili.com/video/' + bv }); if (out.length >= 10) break }
  return out;
})()`

/** 搜索 B站，返回 {ok, items:[{title,href}], error} */
export async function searchBili(keyword, { limit = 5 } = {}) {
  const kw = String(keyword || '').trim().slice(0, 40)
  if (!kw) return { ok: false, error: '关键词为空' }
  const c = await ensure()
  if (!c.ok) return { ok: false, error: c.error }
  const startedByUs = c.startedByUs === true
  try {
    await c.send('Page.navigate', { url: 'https://search.bilibili.com/all?keyword=' + encodeURIComponent(kw) }, 20000)
    await sleep(4500)
    const raw = await c.evaluate(EXTRACT, 10000)
    const items = Array.isArray(raw) ? raw.slice(0, limit) : []
    return items.length ? { ok: true, items, keyword: kw } : { ok: false, error: '页面上没找到视频结果' }
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err).slice(0, 80) }
  } finally {
    try { c.close() } catch { /* ignore */ }
    if (startedByUs) closeBrowser()
  }
}
