// 会话 id 只认标准 uuid：历史 bug 把 sid 拼成 uuid-rxxx-rxxx… 的长串，宿主直接 400
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const base = pathToFileURL(join(process.cwd(), 'lib')).href + '/'
const { isValidSid, sessionIdFor } = await import(base + 'onebot-channel.js')

const ok = []
const T = (n, c, e) => ok.push([n, !!c, e])

const good = sessionIdFor('group', '830148935')
T('派生 id 是合法 uuid', isValidSid(good), good)
T('标准 uuid 认', isValidSid('382ac81e-d2a3-a450-bcb8-f54ceb6c089b') === true)
T('拼长的坏 id 不认', isValidSid('382ac81e-d2a3-a450-bcb8-f54ceb6c089b-rmvtpw51n-rmvuoc06l-rmvur1r4c') === false)
T('空串不认', isValidSid('') === false)
T('纯数字不认', isValidSid('1234567890') === false)

let bad = 0
for (const [n, pass, e] of ok) { if (pass) console.log('OK  ' + n); else { bad++; console.log('FAIL ' + n + '  ' + JSON.stringify(e)) } }
console.log(bad ? ('失败 ' + bad) : '全部通过')
process.exit(bad ? 1 : 0)
