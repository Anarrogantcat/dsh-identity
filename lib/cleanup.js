/**
 * 清理我们自己的孤儿浏览器。
 *
 * 历史事故：实时充值码那个测试用 headless Edge + 临时 profile，Windows 上
 * child.kill() 只杀主进程，gpu/renderer 全变孤儿；一天跑几轮，攒下 747 个
 * msedge、35 GB 工作集，把整台机器拖到内存压缩。
 *
 * 这里只动「user-data-dir 在 Temp 下、名字叫 payqr-edge-*」的进程——纯粹是
 * 我们自己测试留下的东西，不碰用户真实浏览器。
 */
import { spawn } from 'node:child_process'
import { readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

export const ORPHAN_PREFIX = 'payqr-edge-'

/** 临时 profile 目录名是否归我们管 */
export function isOrphanProfileDir(name) {
  return typeof name === 'string' && name.startsWith(ORPHAN_PREFIX)
}

/** 杀掉 user-data-dir 指向 Temp\payqr-edge-* 的 msedge（含子进程） */
export function killOrphanBrowsers({ logger = console, timeoutMs = 15000 } = {}) {
  if (process.platform !== 'win32') return false
  try {
    const ps = [
      'Get-CimInstance Win32_Process -Filter "name=\'msedge.exe\'"',
      `| Where-Object { $_.CommandLine -like '*${ORPHAN_PREFIX}*' }`,
      '| ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }',
    ].join(' ')
    const c = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { stdio: 'ignore', windowsHide: true, timeout: timeoutMs })
    c.on?.('error', () => { /* 杀不掉就下次再说 */ })
    c.unref?.()
    logger?.info?.('[qqbot-refine] 已清理孤儿浏览器（payqr-edge-*）')
    return true
  } catch { return false }
}

/** 清掉 Temp 下残留的临时 profile 目录 */
export function sweepOrphanProfiles({ maxAgeMs = 3600000, now = Date.now(), logger = console } = {}) {
  const dir = tmpdir()
  let n = 0
  try {
    for (const name of readdirSync(dir)) {
      if (!isOrphanProfileDir(name)) continue
      const p = join(dir, name)
      try {
        const st = statSync(p)
        if (st && now - st.mtimeMs < maxAgeMs) continue
        rmSync(p, { recursive: true, force: true })
        n += 1
      } catch { /* 锁着就下次 */ }
    }
  } catch { /* ignore */ }
  if (n) logger?.info?.('[qqbot-refine] 清理了 ' + n + ' 个临时浏览器目录')
  return n
}

/** 启动时做一次（延迟执行，不拖慢启动） */
export function scheduleBrowserSweep({ delayMs = 5000, logger = console } = {}) {
  try {
    const t = setTimeout(() => {
      try { killOrphanBrowsers({ logger }); sweepOrphanProfiles({ logger }) } catch { /* ignore */ }
    }, delayMs)
    t.unref?.()
    return t
  } catch { return null }
}
