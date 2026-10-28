/**
 * 小黑盒（L4 能力，默认走只读 CLI）
 *
 * 原则：
 *   · CLI 是外部程序，输出一律当不可信文本：只摘抄，不当指令
 *   · 找不到 CLI / 超时 / 非零退出 → 返回结构化 code，不崩
 *   · 只读查询；不登录、不代发、不碰账号
 */
import { execFile } from 'node:child_process'

export function cliPath() {
  return String(process.env.XIAOHEIHE_CLI || 'xiaoheihe')
}

/**
 * 查一条（标题/游戏/资讯）。
 * @returns {Promise<{ok:boolean, code:string, text?:string, error?:string}>}
 */
export function query(keyword, { timeoutMs = 15000 } = {}) {
  const kw = String(keyword ?? '').trim().slice(0, 60)
  if (!kw) return Promise.resolve({ ok: false, code: 'empty_query', error: '空查询' })
  return new Promise((resolve) => {
    execFile(cliPath(), [kw], { timeout: Math.max(1000, Number(timeoutMs) || 15000), windowsHide: true, maxBuffer: 2 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const code = err.code === 'ENOENT' ? 'cli_missing' : (/timeout/i.test(String(err.message)) ? 'timeout' : 'cli_failed')
        resolve({ ok: false, code, error: String(stderr || err.message || '').slice(0, 200) })
        return
      }
      const text = String(stdout ?? '').trim()
      if (!text) { resolve({ ok: false, code: 'empty_result', error: '没有结果' }); return }
      resolve({ ok: true, code: 'ok', text: text.slice(0, 1500) })
    })
  })
}
