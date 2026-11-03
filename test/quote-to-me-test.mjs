// QQ 引用回复：引用的是她的话 → 认成「在跟她说话」
import { join } from 'node:path'
import { rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const HOME = process.env.TEMP.replace(/\\/g, '/') + '/dsh-test-quote'
try { rmSync(HOME, { recursive: true, force: true }) } catch {}
process.env.DSH_HOME = HOME
mkdirSync(HOME + '/profiles/desktop', { recursive: true })
writeFileSync(HOME + '/profiles/desktop/cordis.patch.yml', "- id: dsh-identity\n  config: {}\n", 'utf8')

const base = pathToFileURL(join(process.cwd(), 'lib')).href + '/'
const CH = await import(base + 'onebot-channel.js')
const { ensureDirs } = await import(base + 'store.js')
ensureDirs()

const ok = []
const T = (n, c, e) => ok.push([n, !!c, e])

const SELF = '690618714'
function makeChannel(quotedUid) {
  const client = {
    connected: true,
    onEvent: () => () => {},
    call: async (action) => {
      if (action === 'get_msg') return { sender: { user_id: Number(quotedUid) }, message: [{ type: 'text', data: { text: '这问号是给谁的？' } }] }
      return {}
    },
  }
  const ch = new CH.OneBotChannel({ ctx: { get: () => null, on: () => () => {} }, gate: { onInbound: async () => false, onOutbound: async (b, m, a) => ({ args: a }) }, client, logger: { info() {}, warn() {} } })
  ch.selfId = SELF
  return ch
}

// 1) 引用她自己的话 → quoteToMe
{
  const ch = makeChannel(SELF)
  const norm = { quoteId: '7001', images: [], content: '我问你了' }
  await ch.expandMedia(norm)
  T('引用的发送者是她 → quoteToMe', norm.quoteToMe === true, norm)
  T('引用原文进缓存', ch.quoteCache.has('7001'), [...ch.quoteCache.keys()])
}

// 2) 引用别人的话 → 不能乱认
{
  const ch = makeChannel('111222333')
  const norm = { quoteId: '7002', images: [], content: '我问你了' }
  await ch.expandMedia(norm)
  T('引用的是别人 → 不算对她', norm.quoteToMe !== true, norm)
}

let bad = 0
for (const [n, good, e] of ok) { if (good) console.log('OK  ' + n); else { bad++; console.log('FAIL ' + n + '  ' + JSON.stringify(e)) } }
console.log(bad ? ('失败 ' + bad) : '全部通过')
process.exit(bad ? 1 : 0)
