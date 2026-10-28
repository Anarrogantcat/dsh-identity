/**
 * 登录桥（L4/横切）：需要人登录的网站（B站/小黑盒/后台）统一走专用浏览器资料夹。
 *
 * 原则：
 *   · 密码/验证码永远由人自己输入——本模块只负责把浏览器开出来、指路、看状态
 *   · 专用资料夹（<数据目录>/browser-profile）与日常浏览器隔离；不读 cookie 文件
 *   · CDP 端口仅 127.0.0.1；登录状态只通过 /json/version 探测，不碰页面内容
 */
import { spawn } from 'node:child_process'
import { mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { dirs } from './store.js'

export const BRIDGE_PORT = 9334

const CANDIDATES = [
  process.env.EDGE_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean)

export function profileDir() {
  const p = join(dirs.root, 'browser-profile')
  mkdirSync(p, { recursive: true })
  return p
}

export function browserPath() {
  return CANDIDATES.find((p) => { try { return existsSync(p) } catch { return false } }) ?? ''
}

/**
 * 打开登录页（人自己登录）。返回结构化结果，不阻塞等待登录。
 */
export function openLogin(url = 'https://www.bilibili.com') {
  const exe = browserPath()
  if (!exe) return { ok: false, error: '找不到 Edge/Chrome（可设 EDGE_PATH）' }
  const target = String(url ?? '').trim()
  if (!/^https?:\/\//i.test(target)) return { ok: false, error: '只接受 http(s) 地址' }
  try {
    const child = spawn(exe, [
      `--user-data-dir=${profileDir()}`,
      `--remote-debugging-port=${BRIDGE_PORT}`,
      '--no-first-run',
      '--new-window',
      target,
    ], { detached: true, stdio: 'ignore' })
    child.unref?.()
    return { ok: true, port: BRIDGE_PORT, url: target, hint: '登录由你自己输；登录完回来说一声' }
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err) }
  }
}

/** 登录状态：浏览器调试端口活着 = 资料夹还开着（不代表一定已登录） */
export async function bridgeStatus({ timeoutMs = 800 } = {}) {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), Math.max(200, Number(timeoutMs) || 800))
    const res = await fetch(`http://127.0.0.1:${BRIDGE_PORT}/json/version`, { signal: ctrl.signal })
    clearTimeout(t)
    if (!res.ok) return { ok: false, up: false, error: '调试端口未响应' }
    const j = await res.json().catch(() => ({}))
    return { ok: true, up: true, port: BRIDGE_PORT, browser: String(j.Browser ?? '') }
  } catch (err) {
    return { ok: false, up: false, port: BRIDGE_PORT, error: String(err?.message ?? err).slice(0, 80) }
  }
}
