process.env.DSH_HOME = 'C:/Users/Ranmi/AppData/Local/Temp/dsh-test-img';
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
const HOME = process.env.DSH_HOME;
try { rmSync(HOME, { recursive: true, force: true }) } catch {}
mkdirSync(HOME + "/profiles/desktop", { recursive: true });
writeFileSync(HOME + "/profiles/desktop/cordis.patch.yml", "- id: im-qqbot\n  config:\n    appId: '1905982004'\n    appSecret: dummy\n", "utf8");
const base = "file:///C:/Users/Ranmi/.dsh/profiles/desktop/node_modules/dsh-qqbot-refine/";
const CH = await import(base + "lib/onebot-channel.js");
const { loadConfig, saveConfig, clone, DEFAULTS } = await import(base + "lib/config.js");
const { ensureDirs } = await import(base + "lib/store.js");
ensureDirs();
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const server = createServer((req, res) => { res.writeHead(200, { "content-type": "image/png" }); res.end(PNG) });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const ok = []; const T = (n, c, e) => ok.push([n, !!c, e]);
function mkCtx(followed, withAttachment = true) {
  const agents = { get: () => null, resume: async () => { throw new Error('no') }, create: async ({ sessionId }) => ({ agent: { session: { id: sessionId }, followup: (m) => followed.push(m) }, dispose: async () => {} }) };
  const attachment = withAttachment ? { admitPromptContent: async (parts) => parts.map((p) => p.type === 'image' ? { type: 'image', attachment: { attachmentId: 'att-1', mediaType: p.mediaType, bytes: 1, width: 1, height: 1 } } : p) } : null;
  return { get: (n) => (n === 'agents' ? agents : (n === 'attachments' || n === 'attachment') ? attachment : n === 'agentDefaultModel' ? { currentSelection: () => ({ provider: 'p', model: 'm' }) } : null), on: () => () => {} };
}
function mkClient() {
  return { connected: true, url: 'ws://t', onEvent: () => () => {}, call: async (action) => { if (action === 'get_image') return { url: 'http://127.0.0.1:' + port + '/x.png' }; return {} } };
}
const evt = { post_type: 'message', message_type: 'group', group_id: 778, user_id: 5, message_id: 4001, sender: { card: '染喵' }, message: [{ type: 'image', data: { file: 'abc.jpg', url: '' } }, { type: 'text', data: { text: '看看这个' } }] };
// 1) 正常：图片 + 文字 一起投喂
const followed = [];
saveConfig((() => { const c = clone(DEFAULTS); c.transport.mode = 'onebot'; c.scope.groups = ['778']; c.frequency.mentionOnlyGroups = false; c.frequency.naturalMode = false; c.frequency.nonMentionEvery = 0; return c })());
// 白名单闸门会拦；直接放行：把自然模式关掉并加 @
const cfg1 = loadConfig(); cfg1.frequency.mentionOnlyGroups = false; cfg1.frequency.naturalMode = false; cfg1.frequency.nonMentionEvery = 0; saveConfig(cfg1);
const gate = { onInbound: async () => false, onOutbound: async (b, m, a) => ({ args: a }) };
const ch1 = new CH.OneBotChannel({ ctx: mkCtx(followed), gate, client: mkClient(), logger: { info() {}, warn() {} } });
ch1.selfId = '690618714'; ch1.start();
await ch1.handleEvent(evt);
await new Promise((r) => setTimeout(r, 200));
const msg1 = followed[0];
T('图片事件被投递', !!msg1, followed.length);
const parts1 = msg1 ? msg1.content : [];
T('内容里有文字块', parts1.some((p) => p.type === 'text'), parts1);
T('内容里有图像块', parts1.some((p) => p.type === 'image'), parts1);
const img1 = parts1.find((p) => p.type === 'image');
T('图像块带 attachment 引用', !!(img1 && img1.attachment && img1.attachment.attachmentId === 'att-1'), img1);
// 2) vision 关掉：只有文字
const c2 = loadConfig(); c2.transport.onebot.vision = false; saveConfig(c2);
const followed2 = [];
const gate2 = { onInbound: async () => false, onOutbound: async (b, m, a) => ({ args: a }) };
const ch2 = new CH.OneBotChannel({ ctx: mkCtx(followed2), gate: gate2, client: mkClient(), logger: { info() {}, warn() {} } });
ch2.selfId = '690618714'; ch2.start();
await ch2.handleEvent(evt);
await new Promise((r) => setTimeout(r, 150));
const parts2 = followed2[0] ? followed2[0].content : [];
T('vision=off 只有文字', parts2.length === 1 && parts2[0].type === 'text', parts2);
// 3) 没有 attachment 服务：降级成文字，不崩
const c3 = loadConfig(); c3.transport.onebot.vision = true; saveConfig(c3);
const followed3 = [];
const ch3 = new CH.OneBotChannel({ ctx: mkCtx(followed3, false), gate: { onInbound: async () => false, onOutbound: async (b, m, a) => ({ args: a }) }, client: mkClient(), logger: { info() {}, warn() {} } });
ch3.selfId = '690618714'; ch3.start();
await ch3.handleEvent(evt);
await new Promise((r) => setTimeout(r, 150));
const parts3 = followed3[0] ? followed3[0].content : [];
T('没有 attachment 服务时降级为纯文字', parts3.length === 1 && parts3[0].type === 'text', parts3);
server.close();
console.log("=== 入站看图 测试 ===");
let fail = 0;
for (const [n, pass, e] of ok) { console.log((pass ? "OK  " : "FAIL ") + n + (pass ? "" : "   " + JSON.stringify(e))); if (!pass) fail++; }
console.log(fail ? ("失败 " + fail + "/" + ok.length) : ("全部通过 " + ok.length + "/" + ok.length));
process.exit(fail ? 1 : 0);
