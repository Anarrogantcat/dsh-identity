/**
 * 情绪参与记忆权重：记忆的 emotion 字段不能永远是 0，
 * 否则 wEmotion 那一项就是摆设，情绪对「记不记得住」毫无影响。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-moodmem-'))
delete process.env.QQBOT_REFINE_HOME
const url = (p) => new URL(p, import.meta.url).href
const { ensureStore } = await import(url('../lib/config.js'))
const { ensureDirs, dirs, writeJson, peerKey } = await import(url('../lib/store.js'))
const M = await import(url('../lib/moodv2.js'))
const Mem = await import(url('../lib/memory.js'))
ensureStore(); ensureDirs()

const ok = []
const T = (n, p, d) => ok.push([n, !!p, d])

const base = {
  version: 1,
  seven: Object.fromEntries(M.SEVEN.map((k) => [k, 0.3])),
  needs: Object.fromEntries(M.NEEDS.map((k) => [k, 0.3])),
  at: new Date().toISOString(),
}
writeJson(join(dirs.root, 'mood-v2.json'), base)
T('平静时强度接近 0', M.intensity() < 0.05, M.intensity())

const hot = JSON.parse(JSON.stringify(base))
hot.seven.joy = 0.9
writeJson(join(dirs.root, 'mood-v2.json'), hot)
T('高兴时强度明显上来', M.intensity() > 0.5, M.intensity())
T('效价也跟着为正', M.valence() > 0.2, M.valence())

// 同重要度，情绪重的记忆分更高
const PK = peerKey('group', 'G-EMO')
Mem.addMemory(PK, { text: '今天他夸我记性好', category: 'event', importance: 0.5, emotion: 1, valence: 0.6, origin: 'user' })
Mem.addMemory(PK, { text: '今天他随便说了句在吗', category: 'event', importance: 0.5, emotion: 0, valence: 0, origin: 'user' })
const all = Mem.listMemory(PK)
const hotItem = all.find((x) => x.text.includes('夸我'))
const coldItem = all.find((x) => x.text.includes('在吗'))
const pHot = Mem.scoreOf(hotItem, '今天', {}, Date.now()).P
const pCold = Mem.scoreOf(coldItem, '今天', {}, Date.now()).P
T('情绪重的记忆权重大', pHot > pCold, { pHot, pCold })

// web 会话写记忆时真的带上情绪
const { installSessionGrowth } = await import(url('../lib/webgrowth.js'))
const handlers = []
const ctx = { on: (n, f) => { if (n === 'session/event') handlers.push(f) } }
const cfg = { memory: { enabled: true, judge: false } }
installSessionGrowth(ctx, { getConfig: () => cfg, logger: { warn() {} }, getLlm: () => null })
for (const h of handlers) {
  h({ header: { id: 'web-emo' } }, { type: 'user/message', seq: 1, data: { role: 'user', content: [{ type: 'text', text: '我今天真的很开心' }] } })
}
const webMem = Mem.listMemory('web_web-emo')
T('web 记忆带上了情绪强度', (webMem[0]?.emotion ?? 0) > 0.3, webMem[0])

console.log('=== 情绪参与记忆测试 ===')
let fail = 0
for (const [n, p, d] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d))); if (!p) fail++ }
console.log(fail ? '失败 ' + fail : '全部通过')
try { rmSync(process.env.DSH_HOME, { recursive: true, force: true }) } catch {}
process.exit(fail ? 1 : 0)
