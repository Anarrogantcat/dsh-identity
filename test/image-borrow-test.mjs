process.env.DSH_HOME = 'C:/Users/Ranmi/AppData/Local/Temp/dsh-test-borrow';
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from 'node:http';
const HOME = process.env.DSH_HOME;
try { rmSync(HOME, { recursive: true, force: true }) } catch {}
mkdirSync(HOME + "/profiles/desktop", { recursive: true });
writeFileSync(HOME + "/profiles/desktop/cordis.patch.yml", "- id: im-qqbot\n  config:\n    appId: '1905982004'\n    appSecret: dummy\n", "utf8");
const base = "file:///C:/Users/Ranmi/.dsh/profiles/desktop/node_modules/dsh-qqbot-refine/";
const CH = await import(base + "lib/onebot-channel.js");
const { clone, DEFAULTS, saveConfig } = await import(base + "lib/config.js");
const { ensureDirs } = await import(base + "lib/store.js");
ensureDirs();
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const server = createServer((req, res) => { res.writeHead(200, { 'content-type': 'image/png' }); res.end(PNG) });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const followed = [];
const cfg = clone(DEFAULTS); cfg.transport.mode = 'onebot'; cfg.scope.groups = ['830148935']; cfg.transport.onebot.contactOnly = false;
cfg.frequency.naturalMode = false; cfg.frequency.mentionOnlyGroups = false; saveConfig(cfg);
const agents = { get: () => null, resume: async () => { throw new Error('no') }, create: async ({ sessionId }) => ({ agent: { session: { id: sessionId }, followup: (m) => followed.push(m) }, dispose: async () => {} }) };
const attachment = { admitPromptContent: async (parts) => parts.map((p) => p.type === 'image' ? { type: 'image', attachment: { attachmentId: 'a1', mediaType: p.mediaType, bytes: 1, width: 1, height: 1 } } : p) };
const ctx = { get: (n) => n === 'agents' ? agents : n === 'attachments' ? attachment : n === 'agentDefaultModel' ? { currentSelection: () => ({ provider: 'p', model: 'm' }) } : null, on: () => () => {} };
let blockFirst = true;
const gate = { onInbound: async () => { if (blockFirst) { blockFirst = false; return true } return false }, onOutbound: async (b, m, a) => ({ args: a }) };
const client = { connected: true, url: 'ws://t', onEvent: () => () => {}, call: async (a) => a === 'get_image' ? { url: 'http://127.0.0.1:' + port + '/x.png' } : {} };
const ch = new CH.OneBotChannel({ ctx, gate, client, logger: { info() {}, warn() {} } });
ch.selfId = '690618714'; ch.start();
// 1) 单独一张图（无 @）→ 被闸门挡，但要把图记住
await ch.handleEvent({ post_type: 'message', message_type: 'group', group_id: 830148935, user_id: 7, message_id: 7101, sender: { card: '群友' }, message: [{ type: 'image', data: { file: 'x.jpg', url: 'http://127.0.0.1:' + port + '/x.png' } }] });
await new Promise((r) => setTimeout(r, 200));
// 2) 接着 @她 问「这张图」→ 应该把刚才那张图带上
await ch.handleEvent({ post_type: 'message', message_type: 'group', group_id: 830148935, user_id: 7, message_id: 7102, sender: { card: '群友' }, message: [{ type: 'at', data: { qq: '690618714' } }, { type: 'text', data: { text: '你看这张图是啥' } }] });
await new Promise((r) => setTimeout(r, 300));
const ok = []; const T = (n, c, e) => ok.push([n, !!c, e]);
T("图文分开发：后被 @ 时带上了刚才那张图", followed.length >= 1 && followed[followed.length - 1].content.some((p) => p.type === "image"), followed.map((m) => m.content.map((p) => p.type)));
// 3) 别人发的图 + 她没点名 → 另一个人 @ 她 → 也应借到群里最近那张
followed.length = 0;
await ch.handleEvent({ post_type: 'message', message_type: 'group', group_id: 830148935, user_id: 9, message_id: 7201, sender: { card: '艾尔' }, message: [{ type: 'image', data: { file: 'y.jpg', url: 'http://127.0.0.1:' + port + '/y.png' } }] });
await new Promise((r) => setTimeout(r, 200));
await ch.handleEvent({ post_type: 'message', message_type: 'group', group_id: 830148935, user_id: 10, message_id: 7202, sender: { card: '染喵' }, message: [{ type: 'at', data: { qq: '690618714' } }, { type: 'text', data: { text: '看看上面那张图' } }] });
await new Promise((r) => setTimeout(r, 300));
server.close();
T("别人的图 + 你 @ 她 → 也能借到", followed.length >= 1 && followed[followed.length - 1].content.some((p) => p.type === "image"), followed.map((m) => m.content.map((p) => p.type)));
console.log("=== 图文分开 借用 测试 ===");
let fail = 0;
for (const [n, pass, e] of ok) { console.log((pass ? "OK  " : "FAIL ") + n + (pass ? "" : "   " + JSON.stringify(e || {}).slice(0, 200))); if (!pass) fail++; }
console.log(fail ? ("失败 " + fail) : ("全部通过 " + ok.length + "/" + ok.length));
await new Promise((r) => setTimeout(r, 200));
process.exitCode = fail ? 1 : 0;
