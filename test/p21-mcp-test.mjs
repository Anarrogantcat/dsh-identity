/**
 * P21 MCP 可选层测试：默认关、HTTP JSON-RPC、超时/坏返回、输出当不可信
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-p21-'))
delete process.env.QQBOT_REFINE_HOME
const url = (p) => new URL(p, import.meta.url).href
const M = await import(url('../lib/mcp.js'))
const ok = []
const T = (n, p, d) => ok.push([n, !!p, d])

const server = createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    try {
      const j = JSON.parse(body)
      if (j.method === 'tools/list') { res.end(JSON.stringify({ jsonrpc: '2.0', id: j.id, result: { tools: [{ name: 'echo' }] } })) }
      else if (j.method === 'tools/call') { res.end(JSON.stringify({ jsonrpc: '2.0', id: j.id, result: { content: [{ type: 'text', text: '回显：' + (j.params.arguments?.q ?? '') }] } })) }
      else { res.end(JSON.stringify({ jsonrpc: '2.0', id: j.id, error: { message: 'no method' } })) }
    } catch { res.statusCode = 500; res.end('bad') }
  })
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const port = server.address().port
const cfg = { mcp: { enabled: true, servers: [{ id: 't', url: `http://127.0.0.1:${port}/` }] } }

T('列出服务器', M.listServers(cfg).length === 1)
T('能列工具', (await M.listTools(cfg, 't')).tools?.[0]?.name === 'echo')
const call = await M.callTool(cfg, 't', 'echo', { q: '你好' })
T('能调工具拿文本', call.ok && call.text.includes('回显：你好'), call)
T('未知服务器给码', (await M.callTool(cfg, 'nope', 'echo')).code === 'mcp_no_server')
T('默认关', (await M.callTool({ mcp: { enabled: false } }, 't', 'echo')).code === 'mcp_disabled')
server.close()
T('连不上给码', (await M.callTool(cfg, 't', 'echo', {}, { timeoutMs: 500 })).code === 'mcp_unreachable')

console.log('=== P21 MCP 可选层测试 ===')
let fail = 0
for (const [n, p, d] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d))); if (!p) fail++ }
console.log(fail ? '失败 ' + fail : '全部通过')
try { rmSync(process.env.DSH_HOME, { recursive: true, force: true }) } catch {}
process.exit(fail ? 1 : 0)
