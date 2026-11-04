// 画像衰减：久不露面的人印象会过时，速写里不再拿旧印象套人
import { join } from 'node:path'
import { rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const HOME = process.env.TEMP.replace(/\\/g, '/') + '/dsh-test-profile-decay'
try { rmSync(HOME, { recursive: true, force: true }) } catch {}
process.env.DSH_HOME = HOME
mkdirSync(HOME + '/profiles/desktop', { recursive: true })
writeFileSync(HOME + '/profiles/desktop/cordis.patch.yml', "- id: dsh-identity\n  config: {}\n", 'utf8')

const base = pathToFileURL(join(process.cwd(), 'lib')).href + '/'
const { ensureDirs, dirs, sha, writeJson } = await import(base + 'store.js')
const P = await import(base + 'profile.js')
ensureDirs()

const DAY = 86400000
const GROUP = 'G-TEST'
const now = Date.now()
const dir = join(dirs.profiles, sha(GROUP, 12))
mkdirSync(dir, { recursive: true })
writeJson(join(dir, 'index.json'), {
  group: sha(GROUP, 12),
  members: {
    u_active: { key: 'u_active', nick: '活跃的', msgs: 60, chars: 600, lastAt: new Date(now - DAY).toISOString(), traits: ['短句党'], attitude: { ask: 3 }, avgLen: 10 },
    u_fading: { key: 'u_fading', nick: '半隐的', msgs: 60, chars: 600, lastAt: new Date(now - 20 * DAY).toISOString(), traits: ['爱逗她'], attitude: { tease: 3 }, avgLen: 12 },
    u_stale: { key: 'u_stale', nick: '很久没来的', msgs: 90, chars: 900, lastAt: new Date(now - 60 * DAY).toISOString(), traits: ['常聊游戏'], attitude: {}, avgLen: 8 },
  },
})

const ok = []
const eq = (n, c, e) => ok.push([n, !!c, e])

const a = P.memberBrief(GROUP, 'u_active')
eq('活跃的人：新鲜度 active', a && a.freshness.level === 'active', a && a.freshness)
eq('一句话印象包含标签', a && a.impression.includes('短句党'), a && a.impression)

const f = P.memberBrief(GROUP, 'u_fading')
eq('20 天没来：fading', f && f.freshness.level === 'fading', f && f.freshness)
eq('印象里提示最近没露面', f && f.impression.includes('最近没怎么露面'), f && f.impression)

const s = P.memberBrief(GROUP, 'u_stale')
eq('60 天没来：stale', s && s.freshness.level === 'stale', s && s.freshness)
eq('印象里提示别拿旧印象套人', s && s.impression.includes('别拿旧印象套人'), s && s.impression)

const card = P.speedCard(GROUP, { profile: { enabled: true, speedTop: 5, speedChars: 120, minMsgs7d: 20 } })
eq('速写里出现活跃的人', card.includes('活跃的'), card)
eq('速写里不再出现久不来的人', !card.includes('很久没来的'), card)
eq('半隐的人带过期提示', card.includes('印象可能过时'), card)

let bad = 0
for (const [n, pass, e] of ok) {
  if (pass) console.log('OK  ' + n)
  else { bad++; console.log('FAIL ' + n + '  ' + String(JSON.stringify(e)).slice(0, 200)) }
}
console.log(bad ? ('失败 ' + bad) : '全部通过')
process.exit(bad ? 1 : 0)
