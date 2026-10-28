/**
 * P9 生图判定测试：搜索默认关、角色 auto/lock/free、smart 直出
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-p9-'))
delete process.env.QQBOT_REFINE_HOME
const url = (p) => new URL(p, import.meta.url).href
const D = await import(url('../lib/draw.js'))
const { clone, DEFAULTS } = await import(url('../lib/config.js'))

const ok = []
const T = (n, p, d) => ok.push([n, !!p, d])
const cfg = clone(DEFAULTS)

// 搜索默认关
T('搜索默认关（只影响确认文案）', cfg.draw.search === false)
T('确认默认 smart', cfg.draw.confirmMode === 'smart')
T('角色默认 auto', cfg.draw.character === 'auto')

// 角色底子
T('auto：没提到她 → 不套', D.buildDrawPrompt('一只橘猫在窗台') === '一只橘猫在窗台')
T('auto：提到她 → 套', D.buildDrawPrompt('大肥鱼在吃白饭').includes('whale'));
T('lock：永远套', D.buildDrawPrompt('一只猫', { character: 'lock' }).includes('whale'))
T('free：只按描述', D.buildDrawPrompt('大肥鱼在吃白饭', { character: 'free' }).includes('白饭') && !D.buildDrawPrompt('大肥鱼在吃白饭', { character: 'free' }).includes('whale'))

// smart 直出
T('短而明确 → 直出', D.directMode('一只猫在睡觉', 'smart').direct === true)
T('带「像」→ 先确认', D.directMode('画一张像照片一样的猫', 'smart').direct === false)
T('长请求 → 先确认', D.directMode('帮我画一张大肥鱼穿着蓝色长裙站在海边看日落，背景要晚霞和灯塔，还要海浪拍岸', 'smart').direct === false)
T('! 前缀永远直出', D.directMode('!随便画个啥', 'always').direct === true)
T('off 全直出', D.directMode('帮我画一张很长的描述'.repeat(3), 'off').direct === true)
T('always 短请求也确认', D.directMode('一只猫', 'always').direct === false)

console.log('=== P9 生图判定测试 ===')
let fail = 0
for (const [n, p, d] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d))); if (!p) fail++ }
console.log(fail ? `失败 ${fail}` : '全部通过')
try { rmSync(process.env.DSH_HOME, { recursive: true, force: true }) } catch {}
process.exitCode = fail ? 1 : 0
