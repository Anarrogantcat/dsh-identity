// 群名片变更：画像昵称跟着更新（话题卡才不会叫错名）
import { join } from 'node:path'
import { rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const HOME = process.env.TEMP.replace(/\\/g, '/') + '/dsh-test-profile-rename'
try { rmSync(HOME, { recursive: true, force: true }) } catch {}
process.env.DSH_HOME = HOME
mkdirSync(HOME + '/profiles/desktop', { recursive: true })
writeFileSync(HOME + '/profiles/desktop/cordis.patch.yml', "- id: dsh-identity\n  config: {}\n", 'utf8')

const base = pathToFileURL(join(process.cwd(), 'lib')).href + '/'
const { ensureDirs, dirs, sha, writeJson } = await import(base + 'store.js')
const P = await import(base + 'profile.js')
ensureDirs()

const GROUP = 'G-RENAME'
const dir = join(dirs.profiles, sha(GROUP, 12))
mkdirSync(dir, { recursive: true })
const uid = '2849016469'
const key = sha(uid, 12)
writeJson(join(dir, 'index.json'), { group: sha(GROUP, 12), members: { [key]: { key, uid, nick: '旧名片', msgs: 10, chars: 100, traits: [], tags: [] } } })

const ok = []
const T = (n, c, e) => ok.push([n, !!c, e])

T('名册里有这个人', P.listMembers(GROUP).length === 1, P.listMembers(GROUP).length)
T('改名片成功', P.setNick(GROUP, uid, '新名片') === true)
T('画像昵称已更新', P.listMembers(GROUP)[0]?.nick === '新名片', P.listMembers(GROUP)[0]?.nick)
T('重复改同名不报错', P.setNick(GROUP, uid, '新名片') === true)
T('空白名片不改', P.setNick(GROUP, uid, '  ') === false)
T('陌生人返回 false', P.setNick(GROUP, '999999999', '路人') === false)
T('memberBrief 也读到新名', P.memberBrief(GROUP, key)?.nick === '新名片', P.memberBrief(GROUP, key)?.nick)

let bad = 0
for (const [n, pass, e] of ok) { if (pass) console.log('OK   ' + n); else { bad++; console.log('FAIL ' + n + '  ' + String(JSON.stringify(e)).slice(0, 120)) } }
console.log(bad ? ('失败 ' + bad) : '全部通过')
process.exit(bad ? 1 : 0)
