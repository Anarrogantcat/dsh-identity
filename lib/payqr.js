/**
 * 实时充值码：驱动一个专用 Edge（登录态存在 <数据目录>/pay-browser），
 *   打开 DeepSeek 充值页 → 选金额/支付方式 → 点「去支付」→ 截二维码 → 交给通道发送。
 *
 * 前提（一次性）：
 *   1) 跑 `scripts/pay-browser.ps1` 打开专用浏览器，手动登录一次
 *   2) 面板打开 usage.payLiveEnabled（默认关）
 *
 * 真实页面（2026-10 版）结构：
 *   金额/方式都是 <input type=radio>（10/20/50/100/300/500/-1、alipay、wechat）
 *   「去支付」是 span.ds-button__content
 *   二维码在弹窗 .ds-modal 里的 .ds-qr-code > canvas，有效期 15 分钟
 *
 * 全线失败都不抛：返回 { ok:false, error }，由调用方回落静态收款码 / 提示。
 */
import { join, dirname } from 'node:path'
import { writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirs } from './store.js'

export const LIVE_DEFAULTS = {
  port: 9333,
  url: 'https://platform.deepseek.com/top_up',
  amount: 10,
  method: 'wechat',
  waitMs: 20000,
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 一个极简 CDP 客户端：Node 22+ 自带 WebSocket，不引依赖 */
export async function connectCdp(port, timeoutMs = 6000) {
  const base = `http://127.0.0.1:${Number(port) || LIVE_DEFAULTS.port}`
  let list
  try {
    const res = await fetch(`${base}/json/list`, { signal: AbortSignal.timeout(timeoutMs) })
    list = await res.json()
  } catch (err) {
    return { ok: false, error: '专用浏览器没开（跑 scripts/pay-browser.ps1）', detail: String(err?.message ?? err) }
  }
  const page = (Array.isArray(list) ? list : []).find((t) => t && t.type === 'page' && t.webSocketDebuggerUrl)
  if (!page) return { ok: false, error: '浏览器里没有可用标签页' }
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  const pending = new Map()
  let seq = 0
  const send = (method, params = {}, ms = 15000) => new Promise((resolve, reject) => {
    const id = ++seq
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP 超时：' + method)) }, ms)
    pending.set(id, { resolve, reject, timer })
    try { ws.send(JSON.stringify({ id, method, params })) } catch (err) { clearTimeout(timer); pending.delete(id); reject(err) }
  })
  ws.onmessage = (ev) => {
    let m
    try { m = JSON.parse(ev.data) } catch { return }
    if (!m || !m.id || !pending.has(m.id)) return
    const p = pending.get(m.id)
    clearTimeout(p.timer)
    pending.delete(m.id)
    if (m.error) p.reject(new Error(m.error.message || 'CDP 错误'))
    else p.resolve(m.result)
  }
  const opened = await new Promise((resolve) => {
    const t = setTimeout(() => resolve(false), timeoutMs)
    ws.onopen = () => { clearTimeout(t); resolve(true) }
    ws.onerror = () => { clearTimeout(t); resolve(false) }
  })
  if (!opened) { try { ws.close() } catch { /* ignore */ } return { ok: false, error: '连不上浏览器调试端口' } }
  const evaluate = async (expression, ms) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, ms)
    if (r?.exceptionDetails) throw new Error(r.exceptionDetails.text || '页面脚本出错')
    return r?.result?.value
  }
  return { ok: true, ws, send, evaluate, close: () => { try { ws.close() } catch { /* ignore */ } } }
}

/**
 * 连专用浏览器；没开就自动拉起来（默认允许，usage.payLiveAutoStart=false 可关）。
 * 拉起会弹一个可见窗口，属于「现开现截」的正常代价。
 */
export async function ensureBrowser(port, autoStart = true, logger = console) {
  let c = await connectCdp(port)
  if (c.ok) return c
  if (!autoStart) return c
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    const script = join(here, '..', 'scripts', 'pay-browser.ps1')
    spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Port', String(Number(port) || LIVE_DEFAULTS.port)], {
      detached: true, windowsHide: true, stdio: 'ignore',
    }).unref?.()
    logger?.info?.('[qqbot-refine] 充值码专用浏览器没开，正在拉起来…')
  } catch (err) {
    return { ok: false, error: '拉不起专用浏览器：' + String(err?.message ?? err) }
  }
  for (let i = 0; i < 24; i++) {
    await sleep(600)
    c = await connectCdp(port, 2500)
    if (c.ok) return c
  }
  return { ok: false, error: '专用浏览器没开（跑 scripts/pay-browser.ps1）' }
}

/** 选金额：优先按 radio.value 点（真实页面就是这套） */
const pickAmount = (amount) => `(() => {
  const v = ${JSON.stringify(String(amount))};
  const radio = [...document.querySelectorAll('input[type=radio]')].find((i) => i.value === v);
  if (radio) {
    const box = radio.closest('label') || radio.parentElement;
    (box || radio).click(); radio.click();
    radio.dispatchEvent(new Event('change', { bubbles: true }));
    return 'radio:' + radio.checked;
  }
  const want = '¥' + v;
  const el = [...document.querySelectorAll('button,label,div,span')].find((e) => (e.textContent || '').trim() === want);
  if (el) { el.click(); return 'text'; }
  return 'not-found';
})()`

/** 选支付方式：wechat / alipay */
const pickMethod = (method) => `(() => {
  const v = ${JSON.stringify(String(method))};
  const radio = [...document.querySelectorAll('input[type=radio]')].find((i) => i.value === v);
  if (!radio) return 'not-found';
  const box = radio.closest('label') || radio.parentElement;
  (box || radio).click(); radio.click();
  radio.dispatchEvent(new Event('change', { bubbles: true }));
  return 'ok:' + radio.checked;
})()`

/** 点「去支付」（真实页面是 span.ds-button__content） */
const clickPay = `(() => {
  const s = [...document.querySelectorAll('.ds-button__content, button, div, span, a')]
    .find((e) => (e.textContent || '').trim() === '去支付');
  if (!s) return 'not-found';
  const b = s.closest('button') || s.parentElement || s;
  b.click();
  try { s.click() } catch {}
  return 'clicked:' + b.tagName;
})()`

/** 二维码：真实页面是 .ds-qr-code > canvas，弹窗里有「二维码有效期」文案 */
const qrInfo = `(() => {
  const box = document.querySelector('.ds-qr-code');
  const el = (box && box.querySelector('canvas, img, svg')) || box
  if (!el) return null
  const r = el.getBoundingClientRect()
  if (r.width < 100 || r.height < 100) return null
  const modal = el.closest('.ds-modal, [role=dialog]')
  return {
    x: r.x, y: r.y, w: r.width, h: r.height, tag: el.tagName,
    text: (modal ? modal.innerText : '').replace(/\\s+/g, ' ').trim().slice(0, 160),
  }
})()`

/** 抓一张「当下这一单」的二维码图片 */
export async function capturePayQr(cfg, opts = {}) {
  const u = cfg?.usage ?? {}
  const port = Number(u.payLivePort ?? LIVE_DEFAULTS.port)
  const url = String(u.payLiveUrl ?? LIVE_DEFAULTS.url)
  const amount = Number(u.payLiveAmount ?? LIVE_DEFAULTS.amount)
  const method = String(u.payLiveMethod ?? LIVE_DEFAULTS.method)
  const waitMs = Math.max(5000, Number(u.payLiveWaitSec ?? 20) * 1000)
  const logger = opts.logger ?? console

  const c = await ensureBrowser(port, u.payLiveAutoStart !== false, logger)
  if (!c.ok) return { ok: false, error: c.error, detail: c.detail }
  try {
    // 每次都重新加载：清掉上一单的弹窗，也避免旧二维码被当新单
    await c.send('Page.navigate', { url }, 20000)
    await sleep(3000)
    const where = await c.evaluate('location.href', 5000)
    if (/sign_in|login/i.test(String(where))) return { ok: false, error: '专用浏览器还没登录 DeepSeek（在那个窗口登录一次就好）', detail: String(where) }

    const am = await c.evaluate(pickAmount(amount), 8000)
    if (!String(am).startsWith('radio:true') && !String(am).startsWith('text')) {
      // 自定义金额：点「自定义」再往输入框里塞数
      const custom = await c.evaluate(pickAmount(-1), 6000)
      if (String(custom).startsWith('radio:true')) {
        await c.evaluate(`(() => {
          const i = document.querySelector('input[type=number], input[inputmode=numeric], input[type=text]');
          if (!i) return 'no-input';
          const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          i.focus(); set.call(i, ${JSON.stringify(String(amount))});
          i.dispatchEvent(new Event('input', { bubbles: true }));
          return 'ok';
        })()`, 6000)
      }
    }
    const md = await c.evaluate(pickMethod(method), 6000)
    if (!String(md).startsWith('ok:true')) logger?.warn?.('[qqbot-refine] 支付方式没选上：' + md)
    await sleep(400)

    const paid = await c.evaluate(clickPay, 8000)
    if (!String(paid).startsWith('clicked')) return { ok: false, error: '页面上没找到「去支付」按钮（可能改版了）' }

    let info = null
    const deadline = Date.now() + waitMs
    while (Date.now() < deadline) {
      await sleep(900)
      info = await c.evaluate(qrInfo, 6000)
      if (info && info.w >= 100) break
      info = null
    }
    if (!info) {
      const shot = await c.send('Page.captureScreenshot', { format: 'png' }, 15000)
      const p = join(dirs.tmp, `payqr-full-${Date.now()}.png`)
      writeFileSync(p, Buffer.from(shot.data, 'base64'))
      return { ok: true, path: p, full: true, amount, note: '没定位到二维码，发了整页截图' }
    }
    const pad = 14
    const shot = await c.send('Page.captureScreenshot', {
      format: 'png',
      clip: { x: Math.max(0, info.x - pad), y: Math.max(0, info.y - pad), width: info.w + pad * 2, height: info.h + pad * 2, scale: 2 },
    }, 15000)
    const p = join(dirs.tmp, `payqr-${Date.now()}.png`)
    writeFileSync(p, Buffer.from(shot.data, 'base64'))
    const expiry = (String(info.text || '').match(/有效期\s*\d+\s*(?:分钟|秒|小时)/) || [])[0] || ''
    // 截完把弹窗关掉，下次打开干净（Esc 最稳，找不到就点右上角叉）
    try {
      await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
      await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    } catch { /* ignore */ }
    return { ok: true, path: p, amount, w: Math.round(info.w), h: Math.round(info.h), expiry, text: info.text }
  } catch (err) {
    logger?.warn?.('[qqbot-refine] 抓充值码失败：' + String(err?.message ?? err))
    return { ok: false, error: '抓码失败：' + String(err?.message ?? err).slice(0, 80) }
  } finally {
    c.close()
  }
}

/** 专用浏览器是否活着 / 是否已登录 */
export async function probePayBrowser(port) {
  const c = await connectCdp(port ?? LIVE_DEFAULTS.port, 3000)
  if (!c.ok) return { ok: false, error: c.error }
  try {
    const where = await c.evaluate('location.href', 3000)
    return { ok: true, url: where, loggedIn: !/sign_in|login/i.test(String(where)) }
  } catch {
    return { ok: false, error: '浏览器没响应' }
  } finally {
    c.close()
  }
}

/** 专用浏览器的数据目录（登录态在这里，别删） */
export function payProfileDir() {
  return join(dirs.root, 'pay-browser')
}
