process.env.DSH_HOME = process.env.DSH_HOME || 'C:/dsh-test-temp/dsh-test-compact';
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
const HOME = process.env.DSH_HOME;
try { rmSync(HOME, { recursive: true, force: true }) } catch {}
mkdirSync(HOME + "/profiles/desktop", { recursive: true });
writeFileSync(HOME + "/profiles/desktop/cordis.patch.yml", "- id: im-qqbot\n  config:\n    appId: '1905982004'\n    appSecret: dummy\n", "utf8");
const { pathToFileURL } = await import("node:url");
const { homedir } = await import("node:os");
const { join } = await import("node:path");
const base = new URL('../', import.meta.url).href;
const { ensureDirs, peerKey } = await import(base + "lib/store.js");
ensureDirs();
const CH = await import(base + "lib/onebot-channel.js");
const MEM = await import(base + "lib/memory.js");
const ch = new CH.OneBotChannel({ ctx: { get: () => null, on: () => () => {} }, gate: { onInbound: async () => true, onOutbound: async (b, m, a) => ({ args: a }) }, client: { connected: true, onEvent: () => () => {}, call: async () => ({}) }, logger: { info() {}, warn() {} } });
ch.bySession.set('sid1', { scope: 'group', peer: '100000003', target: null, agent: null });
const ev = { type: 'user/message', data: { message: { role: 'user', source: { kind: 'compact-checkpoint' }, content: [{ type: 'text', text: '之前聊了赛程和画图，结论是先修视觉再谈语音。' }] } } };
ch.onSessionEvent({ header: { id: 'sid1' } }, ev);
await new Promise((r) => setTimeout(r, 300));
const list = MEM.listMemory(peerKey('group', '100000003'));
const ok = []; const A = (n, c, e) => ok.push([n, !!c, e]);
A("压缩摘要写进了记忆", list.some((x) => /压缩摘要/.test(String(x.text))), list.slice(-2));
A("记住了结论内容", list.some((x) => /先修视觉再谈语音/.test(String(x.text))), list.slice(-1));
// 普通用户消息不该被当成压缩摘要
ch.onSessionEvent({ header: { id: 'sid1' } }, { type: 'user/message', data: { message: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '普通一句' }] } } });
const list2 = MEM.listMemory(peerKey('group', '100000003'));
A("普通消息不会误记", !list2.some((x) => /普通一句/.test(String(x.text))), list2.length);
console.log("=== 压缩摘要进记忆 测试 ===");
let fail = 0;
for (const [n, pass, e] of ok) { console.log((pass ? "OK  " : "FAIL ") + n + (pass ? "" : "   " + JSON.stringify(e || {}).slice(0, 160))); if (!pass) fail++; }
console.log(fail ? ("失败 " + fail) : ("全部通过 " + ok.length + "/" + ok.length));
await new Promise((r) => setTimeout(r, 150));
process.exitCode = fail ? 1 : 0;
