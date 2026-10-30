/**
 * 一次性清理：把历史事件里"被当成发言记下来的 reasoning（内部草稿）"删掉。
 *
 * 背景（1.9.208 修掉的 bug）：旧的取值逻辑只排除 tool 段，于是每条
 * assistant/message 的内部草稿（reasoning）都被当成"她说的话"写进事件流，
 * 纯英文、每条 300 字。已经写进去的不会自己消失，而事件流是画像/情绪的原料，
 * 所以这里做一次性清理，原则是宁可不删也不误删：
 *
 *   规则 1（精确）：用会话日志里的 reasoning 原文按旧逻辑重算当时的字符串，
 *                   只有完全相等才删。
 *   规则 2（兜底）：纯可打印 ASCII（一个中文都没有）且不是她任何一条真实
 *                   发言的前缀 —— 她跟主人说话是中文，纯英文正文必是草稿。
 *                   在 45 个会话 / 4398 条 bot 事件上验证过：只有 2 条真实
 *                   发言是纯英文，都被规则 2 的前缀检查保住了。
 *
 * 用法：
 *   node scripts/prune-reasoning-events.mjs <会话文件|会话目录> [更多路径…] [--dry]
 *   node scripts/prune-reasoning-events.mjs "$env:USERPROFILE\.dsh\sessions" --dry
 */
import { readFileSync, readdirSync, writeFileSync, existsSync, copyFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import zlib from 'node:zlib'
import { eventsDir } from '../lib/events.js'
import { redactForMemory } from '../lib/privacy.js'

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const VISIBLE_KEEP = 60

/** 旧的取值逻辑（和出 bug 的那版一致，用来重现当时写进去的字符串） */
function oldTextOf(v, depth = 0) {
  if (depth > 5 || v == null) return ''
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return v.map((x) => oldTextOf(x, depth + 1)).filter(Boolean).join(' ')
  if (typeof v === 'object') {
    if (typeof v.text === 'string' && v.type !== 'tool') return v.text
    if (v.content) return oldTextOf(v.content, depth + 1)
    if (v.message) return oldTextOf(v.message, depth + 1)
    if (v.data) return oldTextOf(v.data, depth + 1)
  }
  return ''
}

function readSessionJsonl(file) {
  const buf = readFileSync(file)
  if (buf.length >= 4 && buf.subarray(0, 4).equals(MAGIC)) {
    const offs = []
    let i = 0
    while ((i = buf.indexOf(MAGIC, i)) !== -1) { offs.push(i); i += 4 }
    const out = []
    for (let k = 0; k < offs.length; k++) {
      const end = k + 1 < offs.length ? offs[k + 1] : buf.length
      try { out.push(zlib.zstdDecompressSync(buf.subarray(offs[k], end)).toString('utf8')) } catch { /* false magic */ }
    }
    return out.join('')
  }
  return buf.toString('utf8')
}

function sessionFiles(root) {
  if (!existsSync(root)) return []
  const st = statSync(root)
  if (st.isFile()) return [root]
  const out = []
  for (const name of readdirSync(root)) {
    const p = join(root, name)
    let s
    try { s = statSync(p) } catch { continue }
    if (s.isDirectory()) out.push(...sessionFiles(p))
    else if (/^session\.v4\.jsonl(\.zstd)?$/.test(name)) out.push(p)
  }
  return out
}

const args = process.argv.slice(2)
const dry = args.includes('--dry')
const targets = args.filter((a) => !a.startsWith('--'))
if (!targets.length) {
  console.error('用法: node scripts/prune-reasoning-events.mjs <会话文件|会话目录> [...] [--dry]')
  process.exit(2)
}

const visiblePrefix = new Set()
const exactPolluted = new Set()
let asst = 0
let sessions = 0
for (const t of targets) {
  for (const f of sessionFiles(t)) {
    sessions++
    let text = ''
    try { text = readSessionJsonl(f) } catch (err) { console.log('跳过 ' + f + ': ' + err.message); continue }
    for (const ln of text.split('\n')) {
      if (!ln) continue
      let o
      try { o = JSON.parse(ln) } catch { continue }
      if (o.type !== 'assistant/message') continue
      asst++
      const content = o?.data?.message?.content
      if (Array.isArray(content)) {
        for (const p of content) {
          if (p?.type === 'text' && typeof p.text === 'string') {
            const v = p.text.replace(/\s+/g, ' ').trim()
            if (v) visiblePrefix.add(v.slice(0, VISIBLE_KEEP))
          }
        }
      }
      const raw = o?.data?.message ?? o?.message ?? o?.data?.content ?? o?.data
      const old = redactForMemory(oldTextOf(raw).replace(/\s+/g, ' ').trim().slice(0, 300), {})
      if (old) exactPolluted.add(old)
    }
    text = ''
  }
}
console.log('会话 ' + sessions + ' 个，assistant/message ' + asst + ' 条；真实发言前缀 ' + visiblePrefix.size + ' 个，精确存证 ' + exactPolluted.size + ' 条')

const isDraft = (text) => {
  const t = String(text ?? '')
  if (!t) return false
  if (exactPolluted.has(t)) return true
  if (!/^[\x20-\x7e]+$/.test(t)) return false // 有非 ASCII 就不动
  return !visiblePrefix.has(t.slice(0, VISIBLE_KEEP))
}

let removed = 0
let kept = 0
const evRoot = eventsDir()
// 只动 web_* 这一侧：QQ 群/私聊的事件是通道适配器自己写的真实收发，
// 不存在 reasoning 混进去的问题，没必要碰。
const PEER_PREFIX = 'web_'
for (const note of existsSync(evRoot) ? readdirSync(evRoot) : []) {
  if (!note.startsWith(PEER_PREFIX)) continue
  const nd = join(evRoot, note)
  let st
  try { st = statSync(nd) } catch { continue }
  if (!st.isDirectory()) continue
  for (const f of readdirSync(nd).filter((x) => x.endsWith('.jsonl'))) {
    const p = join(nd, f)
    const lines = readFileSync(p, 'utf8').split('\n')
    const keep = []
    let hit = 0
    for (const ln of lines) {
      if (!ln.trim()) { keep.push(ln); continue }
      let o
      try { o = JSON.parse(ln) } catch { keep.push(ln); continue }
      if (o.origin === 'bot' && isDraft(o.text)) hit++
      else { keep.push(ln); kept++ }
    }
    if (!hit) continue
    removed += hit
    if (!dry) {
      copyFileSync(p, p + '.bak-reasoning-prune')
      writeFileSync(p, keep.join('\n'), 'utf8')
    }
    console.log((dry ? '[dry] ' : '') + '清掉 ' + hit + ' 条  ' + note + '/' + f)
  }
}
console.log((dry ? '将清掉 ' : '清掉 ') + removed + ' 条草稿事件，保留 ' + kept + ' 条')
