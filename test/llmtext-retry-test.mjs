// 模型调用：provider 说 Service is too busy 时自动重试一次
import { join } from 'node:path'
import { rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const HOME = 'C:/Users/Ranmi/AppData/Local/Temp/dsh-test-llmretry'
try { rmSync(HOME, { recursive: true, force: true }) } catch {}
process.env.DSH_HOME = HOME
mkdirSync(HOME + '/profiles/desktop', { recursive: true })
writeFileSync(HOME + '/profiles/desktop/cordis.patch.yml', "- id: dsh-identity\n  config: {}\n", 'utf8')

const base = pathToFileURL(join(process.cwd(), 'lib')).href + '/'
const { ensureDirs } = await import(base + 'store.js')
const { collectStream } = await import(base + 'llmtext.js')
ensureDirs()

const ok = []
const T = (n, c, e) => ok.push([n, !!c, e])
const busy = { type: 'finish', reason: { kind: 'error', failure: { message: 'Service is too busy. Wait and retry.' } } }

// 1) 第一次 busy，第二次成功 → 自动重试
{
  let calls = 0
  const llm = {
    async *stream() {
      calls++
      if (calls === 1) { yield busy; return }
      yield { type: 'text-delta', text: '好的' }
      yield { type: 'finish', reason: { kind: 'stop' } }
      yield { type: 'usage', usage: { totalTokens: 12 } }
    },
  }
  const r = await collectStream(llm, { provider: 'p', model: 'm', prompt: 'x', kind: 'test' })
  T('busy 后自动重试成功', r.text === '好的' && calls === 2, { text: r.text, calls })
}

// 2) 两次都 busy → 不抛异常，返回空正文 + 保留 finish
{
  let calls = 0
  const llm = { async *stream() { calls++; yield busy } }
  const r = await collectStream(llm, { provider: 'p', model: 'm', prompt: 'x', kind: 'test' })
  T('连续 busy 只试两次', calls === 2 && r.text === '', { calls, text: r.text })
  T('finish 保留下来给日志用', /busy/i.test(String(r.finish)), r.finish)
}

// 3) 正常一次成功，不重试
{
  let calls = 0
  const llm = {
    async *stream() {
      calls++
      yield { type: 'text-delta', text: '嗯' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  }
  const r = await collectStream(llm, { provider: 'p', model: 'm', prompt: 'x', kind: 'test' })
  T('正常路径不重试', r.text === '嗯' && calls === 1, { calls })
}

// 4) max-tokens（不是 busy）不重试，避免无意义花钱
{
  let calls = 0
  const llm = { async *stream() { calls++; yield { type: 'finish', reason: { kind: 'max-tokens' } } } }
  const r = await collectStream(llm, { provider: 'p', model: 'm', prompt: 'x', kind: 'test' })
  T('max-tokens 不重试', calls === 1 && r.text === '', { calls })
}

let bad = 0
for (const [n, good, e] of ok) { if (good) console.log('OK  ' + n); else { bad++; console.log('FAIL ' + n + '  ' + JSON.stringify(e)) } }
console.log(bad ? ('失败 ' + bad) : '全部通过')
process.exit(bad ? 1 : 0)
