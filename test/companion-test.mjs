import { testHome as __testHome } from './_test-home.mjs'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
process.env.DSH_HOME = __testHome('dsh-test-companion')
const base = new URL('../', import.meta.url).href
const C = await import(base + 'lib/companion.js')
const ok = []
const T = (name, pass, extra) => ok.push([name, !!pass, extra])
const owner = 'test-owner-private'
const at = (hour, minute = 0, day = 0, second = 0) => new Date(2026, 9, 31 + day, hour, minute, second, 0).getTime()
const mkCfg = (patch = {}) => ({
  frequency: { quietEnabled: false, quietStart: '23:30', quietEnd: '08:00' },
  companion: {
    enabled: true,
    mode: 'auto',
    silentMinutes: 3,
    minGapMinutes: 24,
    replyWindowMinutes: 90,
    quietMinutes: 60,
    dailyMax: 22,
    dailyTokens: 60000,
    maxOutputTokens: 160,
    maxChars: 120,
    promptChars: 1200,
    useMemory: true,
    unansweredBeforeQuiet: 2,
    ...patch,
  },
})

C.resetCompanion(owner, at(9))
T('还没有聊过时不主动开口', C.planCompanionTurn(mkCfg(), { ownerId: owner, now: at(9) }).reason === 'no-conversation')

const cfg = mkCfg()
C.noteCompanionUser(owner, '今天上班有点累', cfg, at(14, 0))
const early = C.planCompanionTurn(cfg, { ownerId: owner, now: at(14, 0, 0, 30) })
T('刚聊完先安静，不立刻追发', !early.ok && early.reason === 'conversation-active', early)
const first = C.planCompanionTurn(cfg, { ownerId: owner, now: at(14, 5) })
T('安静时间过后自然接话', first.ok && first.mode === 'balanced', first)
C.noteCompanionSent(owner, { tokens: 900, mode: first.mode, source: 'llm', reason: first.reason, cfg, now: at(14, 5) })
const waiting = C.planCompanionTurn(cfg, { ownerId: owner, now: at(15, 30) })
T('发完后等待回应，不连续追问', !waiting.ok && waiting.reason === 'awaiting-reply', waiting)

C.resetCompanion(owner, at(9))
C.noteCompanionUser(owner, '最近在看比赛', cfg, at(14, 0))
const miss1 = C.planCompanionTurn(cfg, { ownerId: owner, now: at(14, 5) })
C.noteCompanionSent(owner, { tokens: 400, mode: miss1.mode, source: 'llm', cfg, now: at(14, 5) })
const second = C.planCompanionTurn(cfg, { ownerId: owner, now: at(16, 1) })
T('第一次没回应后仍可再问一次', second.ok && second.unanswered === 1, second)
C.noteCompanionSent(owner, { tokens: 400, mode: second.mode, source: 'llm', cfg, now: at(16, 1) })
const cooldown = C.planCompanionTurn(cfg, { ownerId: owner, now: at(17, 32) })
T('连续两次没回应进入冷却', !cooldown.ok && cooldown.reason === 'unanswered-cooldown', cooldown)
const afterQuiet = C.planCompanionTurn(cfg, { ownerId: owner, now: at(18, 33) })
T('冷却结束后不会永久失联', afterQuiet.ok && afterQuiet.unanswered === 1, afterQuiet)

C.resetCompanion(owner, at(9))
const activeCfg = mkCfg()
C.noteCompanionUser(owner, '在吗', activeCfg, at(14, 0))
C.noteCompanionUser(owner, '陪我说会儿话', activeCfg, at(14, 8))
C.noteCompanionUser(owner, '今天想聊这个', activeCfg, at(14, 16))
const warming = C.planCompanionTurn(activeCfg, { ownerId: owner, now: at(14, 16) })
T('话多时下一句约 10 秒后接上', warming.nextAt >= at(14, 16, 0, 8) && warming.nextAt <= at(14, 16, 0, 12), warming)
const chatty = C.planCompanionTurn(activeCfg, { ownerId: owner, now: at(14, 17) })
T('互动密集时自动切到话多', chatty.mode === 'chatty' && chatty.ok, chatty)
C.noteCompanionSent(owner, { tokens: 300, mode: chatty.mode, source: 'llm', cfg: activeCfg, now: at(14, 17) })
C.noteCompanionUser(owner, '嗯，在听', activeCfg, at(14, 17, 0, 30))
const continued = C.planCompanionTurn(activeCfg, { ownerId: owner, now: at(14, 18, 0, 15) })
T('热聊里主人接话后不会被上一轮冷却卡住', continued.ok && continued.mode === 'chatty', continued)

C.resetCompanion(owner, at(9, 0, 1))
C.noteCompanionUser(owner, '先这样', activeCfg, at(9, 0, 1))
const night = C.planCompanionTurn({ ...activeCfg, frequency: { quietEnabled: true, quietStart: '23:30', quietEnd: '08:00' } }, { ownerId: owner, now: at(1, 0, 2) })
T('夜间安静时段不主动打扰', !night.ok && night.reason === 'quiet-hours', night)

C.resetCompanion(owner, at(9, 0, 2))
C.noteCompanionUser(owner, '还醒着吗', activeCfg, at(1, 0, 3))
C.noteCompanionUser(owner, '再聊一会儿', activeCfg, at(1, 1, 3))
const nightChatty = C.planCompanionTurn(
  { ...activeCfg, frequency: { quietEnabled: true, quietStart: '23:30', quietEnd: '08:00' } },
  { ownerId: owner, now: at(1, 1, 3, 20) },
)
T('夜间已经聊热时不被免打扰打断', nightChatty.ok && nightChatty.mode === 'chatty', nightChatty)

C.resetCompanion(owner, at(9))
const onceCfg = mkCfg({ dailyMax: 1 })
C.noteCompanionUser(owner, '今天聊一句', onceCfg, at(10, 0))
C.noteCompanionSent(owner, { tokens: 100, mode: 'balanced', source: 'llm', cfg: onceCfg, now: at(10, 30) })
const daily = C.planCompanionTurn(onceCfg, { ownerId: owner, now: at(11, 45) })
T('每日条数达到上限就停主动消息', !daily.ok && daily.reason === 'daily-limit', daily)
T('每日主动上限支持到 1000', C.normalizeCompanion({ dailyMax: 1000 }).dailyMax === 1000, C.normalizeCompanion({ dailyMax: 1000 }))
T('每日主动上限不会超过 1000', C.normalizeCompanion({ dailyMax: 1200 }).dailyMax === 1000, C.normalizeCompanion({ dailyMax: 1200 }))

C.resetCompanion(owner, at(9))
const tokenCfg = mkCfg({ mode: 'chatty', dailyTokens: 1000 })
C.noteCompanionUser(owner, '继续聊', tokenCfg, at(10, 0))
C.noteCompanionSent(owner, { tokens: 1000, mode: 'chatty', source: 'llm', cfg: tokenCfg, now: at(10, 30) })
const token = C.planCompanionTurn(tokenCfg, { ownerId: owner, now: at(11, 45) })
T('主动 token 预算用完就停', !token.ok && token.reason === 'token-limit', token)

C.resetCompanion(owner, at(9))
const quietCfg = mkCfg()
C.noteCompanionUser(owner, '别烦我，我在忙', quietCfg, at(14, 0))
const requestedQuiet = C.planCompanionTurn(quietCfg, { ownerId: owner, now: at(14, 5) })
T('主人明确要安静时立刻收住', !requestedQuiet.ok && requestedQuiet.reason === 'unanswered-cooldown', requestedQuiet)

let llmRequest = null
const fakeLlm = {
  async *stream(request) {
    llmRequest = request
    yield { type: 'text-delta', text: '刚才说到比赛|||后来怎么样了？' }
    yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 20 } }
    yield { type: 'finish', reason: 'stop' }
  },
}
const llmCfg = mkCfg({ llmProvider: 'test-provider', llmModel: 'test-model' })
const companionPersonaFile = join(process.env.DSH_HOME, 'personas', 'companion-persona.md')
mkdirSync(dirname(companionPersonaFile), { recursive: true })
const companionPersona = '你是用户自己填写的测试人格。\n' + '保持自然和具体。'.repeat(80) + '【主动陪聊人格结尾】'
writeFileSync(companionPersonaFile, companionPersona, 'utf8')
llmCfg.identity = { baseTextFile: companionPersonaFile, baseText: '不应使用的内联备用。', baseTextMaxChars: 3000, maxChars: 4000 }
const composed = await C.composeCompanionMessage(llmCfg, fakeLlm, {
  ownerId: owner,
  plan: { ok: true, mode: 'balanced', reason: '测试主动开口' },
  now: at(15, 0),
})
T('模型能生成主动私聊内容', composed.ok && composed.source === 'llm', composed)
T('主动内容不会带出 |||', !composed.text.includes('|||') && !composed.text.includes('｜｜｜'), composed.text)
T('主动调用记录 token', composed.tokens === 120, composed.tokens)
T('主动陪聊使用用户配置的人格文件', String(llmRequest?.system || '').includes('【主动陪聊人格结尾】'), llmRequest?.system)
T('主动陪聊不再额外截到 300 字', String(llmRequest?.system || '').includes('【主动陪聊人格结尾】'), String(llmRequest?.system || '').length)

const routedLlmCfg = mkCfg()
routedLlmCfg.integration = { llmProvider: 'routed-provider', llmModel: 'routed-model' }
const routed = await C.composeCompanionMessage(routedLlmCfg, fakeLlm, {
  ownerId: owner,
  plan: { ok: true, mode: 'balanced', reason: '使用宿主默认模型路由' },
  now: at(15, 5),
})
T('主动陪聊会沿用默认模型路由', routed.ok && routed.source === 'llm', routed)

const status = C.companionStatus({ roles: { owners: [owner] }, companion: mkCfg().companion }, at(15, 0))
T('状态里不暴露 Owner 原始号码', !JSON.stringify(status).includes(owner), status)
T('状态包含三档模式和配额', ['quiet', 'balanced', 'chatty'].includes(status.mode) && status.dailyCap > 0 && status.tokenCap > 0, status)

console.log('=== Owner 私聊长期陪聊测试 ===')
let fail = 0
for (const [name, pass, extra] of ok) {
  console.log((pass ? 'OK  ' : 'FAIL ') + name + (pass ? '' : '   ' + JSON.stringify(extra)))
  if (!pass) fail++
}
console.log(fail ? ('失败 ' + fail) : '全部通过')
process.exit(fail ? 1 : 0)
