/**
 * QQ 主人的 pwsh 工具：默认关、只主人、危险命令拦、真能跑（本机）
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOME = mkdtempSync(join(tmpdir(), 'dsh-shell-'))
process.env.DSH_HOME = HOME
delete process.env.QQBOT_REFINE_HOME

const base = new URL('../', import.meta.url).href
const { ensureStore, clone, DEFAULTS } = await import(base + 'lib/config.js')
const { ensureDirs, peerKey } = await import(base + 'lib/store.js')
const persona = await import(base + 'lib/persona.js')
const T = await import(base + 'lib/toolgate.js')
ensureStore(); ensureDirs()

const ok = []
const A = (n, p, d) => ok.push([n, !!p, d])

const cfg = clone(DEFAULTS)
cfg.roles.owners = ['U_OWNER']
cfg.tools.ownerShell = false
const getConfig = () => cfg

const OWNER_SID = await persona.sessionIdFor('1905982004', 'c2c', 'U_OWNER')
persona.rememberSession(OWNER_SID, peerKey('c2c', 'U_OWNER'), 'c2c', 'U_OWNER')
const MEMBER_SID = await persona.sessionIdFor('1905982004', 'c2c', 'U_MEMBER')
persona.rememberSession(MEMBER_SID, peerKey('c2c', 'U_MEMBER'), 'c2c', 'U_MEMBER')
const GROUP_SID = await persona.sessionIdFor('1905982004', 'group', 'G1')
persona.rememberSession(GROUP_SID, peerKey('group', 'G1'), 'group', 'G1')

// 注册：定义合法、不重复
let captured = null
let registered = 0
const agent = {
  session: { id: OWNER_SID },
  ctx: { tools: { get: () => null, register: (d) => { captured = d; registered += 1; return () => {} } } },
}
A('注册成功', T.ensureShellTool(agent, getConfig) === 1 && registered === 1, registered)
A('名字是 pwsh', captured?.name === 'pwsh', captured?.name)
A('output.schema 是 string', captured?.output?.schema?.type === 'string', captured?.output?.schema)
A('参数要 command', (captured?.parameters?.required || []).includes('command'), captured?.parameters)
A('第二次不重复注册', T.ensureShellTool(agent, getConfig) === 0 && registered === 1)

const owner = { session: { id: OWNER_SID } }
const member = { session: { id: MEMBER_SID } }
const groupOwner = { session: { id: GROUP_SID } }
T.setTurnRole(GROUP_SID, 'owner')
T.setTurnRole(MEMBER_SID, 'member')

// 默认关：一律拒绝
A('开关关着 → 拒绝', /还没打开/.test(T.shellRefusal({ command: 'echo hi' }, owner, getConfig)), T.shellRefusal({ command: 'echo hi' }, owner, getConfig))

cfg.tools.ownerShell = true
A('主人私聊 → 放行', T.shellRefusal({ command: 'echo hi' }, owner, getConfig) === '')
A('非主人 → 拒绝', /只有主人/.test(T.shellRefusal({ command: 'echo hi' }, member, getConfig)), T.shellRefusal({ command: 'echo hi' }, member, getConfig))
A('群里主人说话 → 放行', T.shellRefusal({ command: 'echo hi' }, groupOwner, getConfig) === '')
T.setTurnRole(GROUP_SID, 'member')
A('群里别人说话 → 拒绝', /只有主人/.test(T.shellRefusal({ command: 'echo hi' }, groupOwner, getConfig)))
T.setTurnRole(GROUP_SID, 'owner')

// 危险命令：开关开着也拦
const danger = T.shellRefusal({ command: 'rm -rf /tmp/x' }, owner, getConfig)
A('危险命令被拦', /危险命令/.test(danger), danger)
A('空命令被拦', /空命令/.test(T.shellRefusal({ command: '  ' }, owner, getConfig)))

// 真跑一条（只在本机 Windows 上验证）
if (process.platform === 'win32') {
  const r = await T.runShellCommand('Write-Output "shell-ok"', { timeoutMs: 15000 })
  A('真的能执行并拿到输出', r.ok === true && /shell-ok/.test(r.out), { code: r.code, out: r.out })
  const bad = await T.runShellCommand('Write-Error "boom"', { timeoutMs: 15000 })
  A('失败命令有非零退出码', bad.ok === false && bad.code !== 0, { code: bad.code, err: bad.err.slice(0, 60) })
} else {
  const r = await T.runShellCommand('echo shell-ok', { timeoutMs: 10000 })
  A('真的能执行并拿到输出', r.ok === true && /shell-ok/.test(r.out), r)
}

// 超时会被掐掉
{
  const cmd = process.platform === 'win32' ? 'Start-Sleep -Seconds 5' : 'sleep 5'
  const r = await T.runShellCommand(cmd, { timeoutMs: 1200 })
  A('超时被终止', r.ok === false && /超时/.test(r.err), { code: r.code, ms: r.ms })
}

// 通过 execute 走完整链路：开关关着不该真的执行
{
  cfg.tools.ownerShell = false
  const out = await captured.execute({ command: 'Write-Output "should-not-run"' })
  A('execute 在开关关着时拒绝执行', /还没打开/.test(out) && !out.includes('should-not-run'), out)
}

console.log('=== QQ 主人 pwsh 工具测试 ===')
let fail = 0
for (const [n, p, d] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d))); if (!p) fail++ }
console.log(fail ? `失败 ${fail}` : '全部通过')
try { rmSync(HOME, { recursive: true, force: true }) } catch { /* ignore */ }
process.exitCode = fail ? 1 : 0
