/**
 * P16 改名一致性测试：包名 / 客户端模块 id / bundle 名 / 显示名必须一致
 * 防的是：改了 package.json 忘了 client.js（启动 import failed）这种漏项。
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')
const pkg = JSON.parse(read('package.json'))
const client = read('client.js')
const patch = read('cordis.patch.yml')
const panel = read('panel.html')
const ok = []
const T = (n, p, d) => ok.push([n, !!p, d])

T('包名是 dsh-identity', pkg.name === 'dsh-identity', pkg.name)
T('客户端模块 id = 包名', client.includes("id: 'dsh-identity'"), client.match(/id: '[^']+'/)?.[0])
T('客户端不再注册旧 id', !client.includes("id: 'dsh-qqbot-refine'"))
T('bundle 名 = 包名', new RegExp('name:\\s*dsh-identity').test(patch))
T('面板标题是身份系统', panel.includes('大肥鱼 · 身份系统'))
T('客户端显示名是身份系统', client.includes('大肥鱼 · 身份系统') && !client.includes('QQ 增强'))
T('客户端/bundle 无旧 id', !/dsh-qqbot-refine/.test(client + patch))

console.log('=== P16 改名一致性测试 ===')
let fail = 0
for (const [n, p, d] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d))); if (!p) fail++ }
console.log(fail ? '失败 ' + fail : '全部通过')
process.exit(fail ? 1 : 0)
