/**
 * 「诊断 → 出补丁 → 等确认 → 合并」这一段
 *
 * 设计：
 *   · 诊断阶段只读（模型自己有 read/grep/pwsh，但提示词要求不改文件）
 *   · 模型把补丁贴在 diff 代码块里发到群里；通道层抓下来存进 pendingFix
 *   · Owner 回「#合并」才真正 git apply；先 --check，再 apply，失败就原样退回
 *   · 只允许打在白名单仓库（默认插件的 git 仓库）
 */
import { spawn } from 'node:child_process'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { audit } from './store.js'

const pending = new Map()
const FENCE_RE = /```diff\s*\n([\s\S]*?)```/gi

/** 从一段文本里抓 diff 代码块（取最后一个：模型通常先解释再贴补丁） */
export function extractDiff(text) {
  const s = String(text ?? '')
  FENCE_RE.lastIndex = 0
  let m, last = null
  while ((m = FENCE_RE.exec(s)) !== null) last = m[1]
  return last && last.trim() ? last : ''
}

export function noteDiff(peer, text) {
  const d = extractDiff(text)
  if (!d) return null
  const rec = { peer: String(peer), diff: d, at: Date.now(), lines: d.split('\n').length }
  pending.set(String(peer), rec)
  if (pending.size > 50) { const k = pending.keys().next().value; pending.delete(k) }
  try { audit('fix.pending', { peer: String(peer).slice(0, 10), lines: rec.lines }) } catch { /* ignore */ }
  return rec
}

export function peekDiff(peer) { return pending.get(String(peer)) ?? null }
export function dropDiff(peer) { pending.delete(String(peer)) }

function run(cmd, args, cwd, timeoutMs = 120000) {
  return new Promise((resolve) => {
    let out = '', err = ''
    let child
    try { child = spawn(cmd, args, { cwd, windowsHide: true }) } catch (e) { return resolve({ code: -1, out, err: String(e) }) }
    const t = setTimeout(() => { try { child.kill() } catch { /* ignore */ } }, timeoutMs)
    t.unref?.()
    child.stdout?.on('data', (d) => { out += String(d) })
    child.stderr?.on('data', (d) => { err += String(d) })
    child.on('error', (e) => { clearTimeout(t); resolve({ code: -1, out, err: String(e) }) })
    child.on('close', (code) => { clearTimeout(t); resolve({ code, out, err }) })
  })
}

/** 合并：git apply --check → apply */
export async function applyFix(diff, { cwd } = {}) {
  const text = String(diff ?? '')
  if (!text.trim()) return { ok: false, message: '没有待合并的补丁' }
  if (!cwd) return { ok: false, message: '没有配置仓库目录（fix.repo）' }
  let dir
  try { dir = mkdtempSync(join(tmpdir(), 'qqbot-fix-')) } catch { return { ok: false, message: '创建临时目录失败' } }
  const patch = join(dir, 'change.patch')
  writeFileSync(patch, text, 'utf8')
  const check = await run('git', ['apply', '--check', '--whitespace=nowarn', patch], cwd, 30000)
  if (check.code !== 0) return { ok: false, message: '补丁打不上：' + (check.err || check.out).trim().slice(0, 200) }
  const applied = await run('git', ['apply', '--whitespace=nowarn', patch], cwd, 30000)
  if (applied.code !== 0) return { ok: false, message: '应用失败：' + (applied.err || applied.out).trim().slice(0, 200) }
  try { audit('fix.applied', { cwd, lines: text.split('\n').length }) } catch { /* ignore */ }
  return { ok: true, message: '补丁已应用（未自动跑测试；要跑请说 #测试）' }
}

/** 跑仓库里的测试（test/*-test.mjs，逐个跑，返回汇总） */
export async function runTests(cwd, timeoutMs = 300000) {
  const ls = await run('node', ['-e', "const{readdirSync}=require('fs');console.log(readdirSync('test').filter(f=>f.endsWith('-test.mjs')).join('\\n'))"], cwd, 20000)
  const files = (ls.out || '').split('\n').map((s) => s.trim()).filter(Boolean)
  if (!files.length) return { ok: false, text: '没找到测试文件' }
  let fail = 0
  const failed = []
  for (const f of files) {
    const r = await run('node', ['test/' + f], cwd, timeoutMs)
    if (r.code !== 0) { fail += 1; failed.push(f) }
  }
  return { ok: fail === 0, total: files.length, failed, text: fail ? ('失败：' + failed.join(', ')) : ('全部通过 ' + files.length + ' 个测试文件') }
}

// ── 诊断模式（只读）：下一条该群的请求里注入「只查不改」的指令 ──
const diag = new Map()
const DIAG_TTL = 10 * 60 * 1000

export function setDiag(peer, task) {
  diag.set(String(peer), { task: String(task || '').slice(0, 200), at: Date.now() })
}

export function takeDiag(peer) {
  const k = String(peer)
  const d = diag.get(k)
  if (!d) return null
  diag.delete(k)
  if (Date.now() - d.at > DIAG_TTL) return null
  return d
}
