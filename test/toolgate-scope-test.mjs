/**
 * 工具白名单自查：别把「只看全局层」的坑踩了。
 *
 * companion 踩过：闸门拿全局工具表当白名单来源，预设层注册的工具不在全局表里，
 * 于是被当成「不存在」→ 直接误杀。
 *
 * 这里的口径：判定只看「工具名 + allowlist」，注册表来源不参与判定；
 * 预设层工具只要名字对上就能走。所以自查要能回答两件事：
 *   1. 会话层有、全局层没有的工具，能不能被看见（presetOnly）
 *   2. 被挡的那些是「按策略挡」还是「根本没看见」——前者合理，后者才是 bug
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOME = mkdtempSync(join(tmpdir(), 'dsh-tg-'))
process.env.DSH_HOME = HOME
delete process.env.QQBOT_REFINE_HOME

const url = (p) => new URL(p, import.meta.url).href
const G = await import(url('../lib/toolgate.js'))
const P = await import(url('../lib/persona.js'))
const { ensureStore, clone, DEFAULTS } = await import(url('../lib/config.js'))
const { ensureDirs } = await import(url('../lib/store.js'))
ensureStore()
ensureDirs()

const ok = []
const T = (n, p, d) => ok.push([n, !!p, d])
const cfg = clone(DEFAULTS)
cfg.roles = { ...cfg.roles, owners: ['999'] }

const def = (name, extra = {}) => ({ name, parameters: { type: 'object', properties: {} }, execute: async () => null, ...extra })

// 一、工具名收集：数组 / Map / 嵌套对象都要扫到，长得像但不是工具的不算
{
  const tools = {
    list: [def('a')],
    map: new Map([['b', def('b')]]),
    nested: { c: def('c') },
    junk: { name: 'not-a-tool' },
  }
  const names = G.collectToolNames(tools).sort()
  T('数组/Map/嵌套都扫到', names.join(',') === 'a,b,c', names)
}

// 二、预设层工具：能看见、按白名单判定
{
  const globalTools = { list: [def('web_search'), def('read')] }
  const agent = { tools: [def('web_search'), def('read'), def('create_goal'), def('mcp__wincu__web_search')] }
  const a = G.auditToolScopes({ tools: globalTools, agent, cfg })
  T('预设层独有的工具被认出来', a.presetOnly.includes('create_goal'), a.presetOnly)
  T('不在白名单的才挡', a.blockedPreset.includes('create_goal'), a.blockedPreset)
  T('白名单里的预设层工具不挡', !a.blockedPreset.includes('mcp__wincu__web_search'), a.blockedPreset)
}

// 三、全局层是空的（QQ 会话常见）：照样能看见会话层工具
{
  const a = G.auditToolScopes({ tools: {}, agent: { tools: [def('create_goal'), def('web_search')] }, cfg })
  T('全局为空也认得会话层', a.globalEmpty === true && a.scope.length === 2, a)
  T('只挡不在白名单的那个', a.blockedPreset.join(',') === 'create_goal', a.blockedPreset)
}

// 四、判定不看注册表来源：群成员会话里，白名单内的放行、白名单外的按策略挡
{
  P.rememberSession('session-tg-member-0001', 'gk', 'group', '111')
  const exec = { agent: { session: { id: 'session-tg-member-0001' } } }
  const v1 = G.decide(def('create_goal'), {}, exec, cfg)
  T('成员用预设层工具按策略挡', v1.allow === false && v1.why === 'not-allowed', v1)
  const v2 = G.decide(def('web_search'), { query: '金价' }, exec, cfg)
  T('白名单里的放行', v2.allow === true, v2)
  const v3 = G.decide(def('some_global_tool'), {}, exec, cfg)
  T('全局注册表里有也不代表放行', v3.allow === false && v3.why === 'not-allowed', v3)
}

// 五、mcp 双下划线短名匹配
{
  T('mcp 短名命中白名单', G.allowHit(['web_search'], 'mcp__wincu__web_search', G.bareToolName('mcp__wincu__web_search')) === true)
  T('通配符前缀命中', G.allowHit(['ig5_*'], 'ig5_open', 'ig5_open') === true)
}

console.log('=== 工具白名单自查 测试 ===')
let fail = 0
for (const [n, p, d] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d))); if (!p) fail++ }
console.log(fail ? `失败 ${fail}` : '全部通过')
try { rmSync(HOME, { recursive: true, force: true }) } catch { /* ignore */ }
process.exitCode = fail ? 1 : 0
