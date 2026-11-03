// 情绪 LLM：服务过载不算失败；max-tokens 截断后加预算重试
import { join } from 'node:path'
import { rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const HOME = process.env.TEMP.replace(/\\/g, '/') + '/dsh-test-moodllm'
try { rmSync(HOME, { recursive: true, force: true }) } catch {}
process.env.DSH_HOME = HOME
mkdirSync(HOME + '/profiles/desktop', { recursive: true })
writeFileSync(HOME + '/profiles/desktop/cordis.patch.yml', "- id: dsh-identity\n  config: {}\n", 'utf8')

const base = pathToFileURL(join(process.cwd(), 'lib')).href + '/'
const { ensureDirs } = await import(base + 'store.js')
const M = await import(base + 'moodllm.js')
ensureDirs()

const cfg = { integration: { llmEnabled: true, llmProvider: 'test-provider', llmModel: 'test-model', llmEvery: 2 }, mood: {} }
const PK = 'g_moodtest'
const ok = []
const T = (n, c, e) => ok.push([n, !!c, e])

const busy = { type: 'finish', reason: { kind: 'error', failure: { message: 'Service is too busy. Wait and retry.' } } }
const good = JSON.stringify({ happy: 0.6, reason: '被人夸了' })

// 1) 过载：不计失败、不进暂停
M.resetLlmState()
M.pushMessage(PK, '今天好累啊', 'member')
M.pushMessage(PK, '有点撑不住', 'member')
{
  const llm = { async *stream() { yield busy } }
  const r = await M.appraiseWithLlm(cfg, llm, PK, { warn() {} })
  T('过载返回失败但写明原因', r.ok === false && /过载/.test(String(r.error)), r)
  T('过载不累计失败、不暂停', M.isPaused() === false, M.isPaused())
}

// 2) max-tokens 空正文：第二次把预算加到 1600 并成功
M.resetLlmState()
M.pushMessage(PK, '今天好累啊', 'member')
M.pushMessage(PK, '有点撑不住', 'member')
{
  const seen = []
  let calls = 0
  const llm = {
    async *stream(req) {
      calls++
      seen.push(req.maxTokens)
      if (calls === 1) { yield { type: 'finish', reason: { kind: 'max-tokens' } }; return }
      yield { type: 'text-delta', text: good }
      yield { type: 'finish', reason: { kind: 'stop' } }
      yield { type: 'usage', usage: { totalTokens: 40 } }
    },
  }
  const r = await M.appraiseWithLlm(cfg, llm, PK, { warn() {} })
  T('max-tokens 后加预算重试成功', r.ok === true, r)
  T('第二次调用 maxTokens=1600', seen.length >= 2 && seen[1] >= 1600, seen)
  T('成功后不暂停', M.isPaused() === false, M.isPaused())
}

// 3) 连续「输出不是 JSON」才进暂停（3 次）
M.resetLlmState()
for (let i = 0; i < 3; i++) {
  M.pushMessage(PK, '今天好累啊', 'member')
  M.pushMessage(PK, '有点撑不住', 'member')
  const llm = {
    async *stream() {
      yield { type: 'text-delta', text: '这是散文不是JSON' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  }
  await M.appraiseWithLlm(cfg, llm, PK, { warn() {} })
}
T('连续 3 次解析失败才暂停', M.isPaused() === true, M.isPaused())

let bad = 0
for (const [n, pass, e] of ok) { if (pass) console.log('OK  ' + n); else { bad++; console.log('FAIL ' + n + '  ' + String(JSON.stringify(e)).slice(0, 240)) } }
console.log(bad ? ('失败 ' + bad) : '全部通过')
process.exit(bad ? 1 : 0)
