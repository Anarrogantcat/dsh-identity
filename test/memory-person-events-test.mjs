/**
 * 记忆注入分层：关于这个人 / 最近发生的事。
 *
 * 以前是一锅流水账，群里几百条原话把「关于你」的事实挤没了——
 * 记得一堆事，却说不出对方是谁。这里守住：人先于事、小标题按需出现、预算内不丢人。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-memgroup-'))
delete process.env.QQBOT_REFINE_HOME

const url = (p) => new URL(p, import.meta.url).href
const { ensureStore, clone, DEFAULTS } = await import(url('../lib/config.js'))
const { ensureDirs, peerKey } = await import(url('../lib/store.js'))
const M = await import(url('../lib/memory.js'))
ensureStore(); ensureDirs()

const ok = []
const T = (n, p, d) => ok.push([n, !!p, d])
const PK = peerKey('group', 'G-MEM')
const cfg = clone(DEFAULTS)
cfg.memory = { ...(cfg.memory ?? {}), injectChars: 600 }

const add = (text, category, importance = 0.5) => M.addMemory(PK, { text, category, importance, source: 'test' }, cfg)

add('主人不吃香菜，闻到就躲', 'preference', 0.7)
add('主人住在成都，做前端', 'fact', 0.6)
for (let i = 0; i < 6; i++) add('今天群里聊了会别的 ' + i, 'event', 0.4)

const card = M.memoryCard(PK, cfg, '')
T('注入里有「关于这个人」', card.includes('关于这个人：'), card)
T('注入里有「最近发生的事」', card.includes('最近发生的事：'), card)
T('人排在前头', card.indexOf('关于这个人：') < card.indexOf('最近发生的事：'), card)
T('偏好进得来', card.includes('不吃香菜'), card)
T('事实进得来', card.includes('成都'), card)

// 预算很紧时，人也不能被事件挤掉
const tight = clone(cfg)
tight.memory = { ...tight.memory, injectChars: 260 }
const t2 = M.memoryCard(PK, tight, '')
T('紧预算下人仍在', t2.includes('不吃香菜') || t2.includes('成都'), t2)
T('紧预算仍不超字数', t2.length <= 260, t2.length)

// 只有事件时不加小标题（保持旧样子）
const PK2 = peerKey('group', 'G-MEM2')
for (let i = 0; i < 3; i++) M.addMemory(PK2, { text: '纯事件 ' + i, category: 'event', importance: 0.5 }, cfg)
const onlyEvents = M.memoryCard(PK2, cfg, '')
T('只有事件时不硬加小标题', !onlyEvents.includes('关于这个人：') && !onlyEvents.includes('最近发生的事：'), onlyEvents)

console.log('=== 记忆分层 测试 ===')
let fail = 0
for (const [n, p, d] of ok) {
  console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d)))
  if (!p) fail++
}
console.log(fail ? `失败 ${fail}` : '全部通过')
try { rmSync(process.env.DSH_HOME, { recursive: true, force: true }) } catch { /* ignore */ }
process.exit(fail ? 1 : 0)
