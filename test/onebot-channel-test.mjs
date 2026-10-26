process.env.DSH_HOME = 'C:/Users/Ranmi/AppData/Local/Temp/dsh-test-onebot-ch';
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
const HOME = process.env.DSH_HOME;
try { rmSync(HOME, { recursive: true, force: true }) } catch {}
mkdirSync(HOME + "/profiles/desktop", { recursive: true });
writeFileSync(HOME + "/profiles/desktop/cordis.patch.yml", "- id: im-qqbot\n  config:\n    appId: '1905982004'\n    appSecret: dummy\n", "utf8");
const base = "file:///C:/Users/Ranmi/.dsh/profiles/desktop/node_modules/dsh-qqbot-refine/";
const CH = await import(base + "lib/onebot-channel.js");
const { ensureDirs } = await import(base + "lib/store.js");
const { loadConfig, saveConfig, clone, DEFAULTS } = await import(base + "lib/config.js");
ensureDirs();
const cfg = clone(DEFAULTS); cfg.transport.mode = "onebot"; saveConfig(cfg);

const ok = [];
const A = (n, c, e) => ok.push([n, !!c, e]);

// ── 1. 会话 id 派生 ──
const sid1 = CH.sessionIdFor("group", "123456");
const sid2 = CH.sessionIdFor("group", "123456");
const sid3 = CH.sessionIdFor("group", "654321");
const sid4 = CH.sessionIdFor("c2c", "123456");
A("sessionId 确定性", sid1 === sid2, sid1);
A("sessionId 是 uuid 形态", /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(sid1), sid1);
A("不同群不同 id", sid1 !== sid3);
A("群/私聊不撞", sid1 !== sid4);

// ── 2. 事件归一化：数组段 ──
const evGroup = {
  post_type: "message", message_type: "group", group_id: 123456, user_id: 10001, message_id: 9001,
  sender: { card: "染喵本喵", nickname: "染喵", role: "owner" },
  message: [
    { type: "at", data: { qq: "690618714", name: "大肥鱼" } },
    { type: "text", data: { text: " 在吗" } },
    { type: "image", data: { url: "https://x/y.png", file: "y.png" } },
    { type: "reply", data: { id: "8800" } },
  ],
};
const n1 = CH.normalizeEvent(evGroup, "690618714");
A("群消息 scope/peer/sender", n1.scope === "group" && n1.peer === "123456" && n1.sender === "10001", n1);
A("@ 自己被识别为 mention", n1.mentions.length === 1 && n1.mentions[0].bot === true, n1.mentions);
A("@ 自己不进正文", !n1.content.includes("@大肥鱼"), n1.content);
A("正文保留文本", n1.content.includes("在吗"), n1.content);
A("图片进附件", n1.attachments.length === 1 && n1.attachments[0].url === "https://x/y.png", n1.attachments);
A("引用 id 记下", n1.quoteId === "8800", n1.quoteId);
A("群名片优先", n1.senderName === "染喵本喵", n1.senderName);
A("QQ 角色透传", n1.role === "owner", n1.role);

const evOther = { post_type: "message", message_type: "group", group_id: 1, user_id: 2, message_id: 3, sender: { nickname: "别人" }, message: [{ type: "at", data: { qq: "999", name: "小明" } }, { type: "text", data: { text: "你好" } }] };
const n2 = CH.normalizeEvent(evOther, "690618714");
A("@ 别人留在正文里", n2.content.includes("@小明") && n2.mentions.length === 0, n2.content);

// ── 3. 私聊 + CQ 字符串兜底 ──
const evDm = { post_type: "message", message_type: "private", user_id: 10001, message_id: 7, sender: { nickname: "染喵" }, message: "[CQ:at,qq=690618714] hi [CQ:face,id=1]" };
const n3 = CH.normalizeEvent(evDm, "690618714");
A("CQ 字符串解析出 @", n3.scope === "c2c" && n3.mentions.length === 1, n3);
A("CQ 文本拼接", n3.content.includes("hi") && n3.content.includes("[表情]"), n3.content);
A("非消息事件不处理", CH.normalizeEvent({ post_type: "meta_event" }, "1") === null);
A("自己发的消息不处理", CH.normalizeEvent({ ...evGroup, post_type: "message_sent" }, "1") === null);

// ── 4. 正文组装 / 消息体 ──
const body1 = CH.bodyOf(n1);
A("群正文带[名片(QQ)]", body1.startsWith("[染喵本喵(10001)]"), body1);
A("被 @ 标记 (@你)", body1.includes("(@你)"), body1);
const body2 = CH.bodyOf(n3);
A("私聊正文原样", body2 === n3.content, body2);

// ── 5. 用户消息 & assistant 文本 ──
const um = CH.buildUserMessage("你好");
A("用户消息形状", um.role === "user" && um.content[0].type === "text" && typeof um.id === "string" && um.source.kind.startsWith("plugin:"), um);
A("用户消息已冻结", Object.isFrozen(um) && Object.isFrozen(um.content), Object.isFrozen(um));
const at = CH.textOfMessage({ content: [{ type: "text", text: "第一句" }, { type: "tool_use" }, { type: "text", text: "第二句" }] });
A("assistant 只抽文本块", at === "第一句\n第二句", at);
A("空消息返回空串", CH.textOfMessage({ content: [] }) === "");

// ── 6. bot 适配器：出站走闸门 + 正确 action ──
const calls = [];
const fakeClient = { connected: true, call: async (action, params) => { calls.push([action, params]); return { message_id: 1 } }, onEvent: () => () => {}, url: "ws://t" };
const gateLines = [];
const fakeGate = {
  onInbound: async () => false,
  onOutbound: async (bot, method, args) => { gateLines.push([method, args]); return { args } },
};
const bot = new CH.OneBotBot({ client: fakeClient, gate: fakeGate, logger: { info() {}, warn() {} }, selfId: () => "690618714" });
await bot.sendText({ scope: "group", targetId: "123456", msgId: "1" }, "在的");
A("sendText 走闸门", gateLines.length === 1 && gateLines[0][0] === "sendText", gateLines);
A("群文本 → send_group_msg", calls[0][0] === "send_group_msg" && calls[0][1].group_id === 123456, calls[0]);
A("群回复带引用段（O5）", calls[0][1].message[0]?.type === "reply" && calls[0][1].message[0].data.id === "1", calls[0][1].message);
A("文本在最后一段", calls[0][1].message.at(-1).type === "text" && calls[0][1].message.at(-1).data.text === "在的", calls[0][1].message);
await bot.sendText({ scope: "c2c", targetId: "10001", msgId: "2" }, "私聊");
A("私聊文本 → send_private_msg", calls[1][0] === "send_private_msg" && calls[1][1].user_id === 10001, calls[1]);

const blockGate = { onInbound: async () => false, onOutbound: async () => ({ block: true }) };
const bot2 = new CH.OneBotBot({ client: fakeClient, gate: blockGate, logger: { warn() {} }, selfId: () => "1" });
const before = calls.length;
await bot2.sendText({ scope: "group", targetId: "1", msgId: "1" }, "不该发");
A("闸门 block 时不发", calls.length === before, calls.length - before);

const rewriteGate = { onOutbound: async () => ({ args: [{ scope: "group", targetId: "1", msgId: "1" }, "改过的文本"] }) };
const bot3 = new CH.OneBotBot({ client: fakeClient, gate: rewriteGate, logger: { warn() {} } });
await bot3.sendText({ scope: "group", targetId: "1", msgId: "1" }, "原文");
A("闸门改写的文本生效", calls[calls.length - 1][1].message.at(-1).data.text === "改过的文本", calls[calls.length - 1][1].message);

// 媒体
await bot.sendImage({ scope: "group", targetId: "1", msgId: "1" }, { localPath: "D:\\tmp\\a.png" });
const imgCall = calls[calls.length - 1];
A("本地图片 → file:/// URI", imgCall[1].message[0].type === "image" && imgCall[1].message[0].data.file === "file:///D:/tmp/a.png", imgCall[1].message[0]);
await bot.sendImage({ scope: "group", targetId: "1", msgId: "1" }, { url: "https://x/a.png" });
A("网络图片原样", calls[calls.length - 1][1].message[0].data.file === "https://x/a.png");
await bot.sendVoice({ scope: "group", targetId: "1", msgId: "1" }, { buffer: Buffer.from("abc") });
A("语音 buffer → base64://", calls[calls.length - 1][1].message[0].data.file.startsWith("base64://"), calls[calls.length - 1][1].message[0]);
await bot.sendFile({ scope: "group", targetId: "1", msgId: "1" }, { localPath: "D:\\tmp\\b.zip" });
const fileCall = calls[calls.length - 1];
A("群文件 → upload_group_file", fileCall[0] === "upload_group_file" && fileCall[1].name === "b.zip", fileCall);

// ── 7. 通道：事件 → agent，session 事件 → 发送 ──
const dispatched = [];
const fakeAgents = {
  get: () => null,
  resume: async () => { throw new Error("没有历史") },
  create: async ({ sessionId }) => ({ agent: { session: { id: sessionId }, followup: (m) => dispatched.push(m) }, dispose: async () => {} }),
};
let sessionHandler = null;
const fakeCtx = {
  get: (name) => (name === "agents" ? fakeAgents : null),
  on: (ev, fn) => { if (ev === "session/event") sessionHandler = fn; return () => { sessionHandler = null } },
};
let evHandler = null;
const client2 = { connected: true, url: "ws://t", call: async (a, p) => { calls.push([a, p]); return {} }, onEvent: (fn) => { evHandler = fn; return () => {} } };
const ch = new CH.OneBotChannel({ ctx: fakeCtx, gate: fakeGate, client: client2, logger: { info() {}, warn() {} } });
ch.start();
A("订阅了 session 事件", typeof sessionHandler === "function");
A("订阅了 onebot 事件", typeof evHandler === "function");
await ch.handleEvent(evGroup);
A("放行后投给模型", dispatched.length === 1, dispatched.length);
A("投递正文含名片", String(dispatched[0]?.content?.[0]?.text ?? "").includes("染喵本喵"), dispatched[0]);
A("dispatch 计数", ch.describe().counts.dispatched === 1 && ch.describe().sessions === 1, ch.describe());
await ch.handleEvent(evGroup);
A("同一条消息去重", dispatched.length === 1, dispatched.length);

const blockCh = new CH.OneBotChannel({ ctx: fakeCtx, gate: { onInbound: async () => true, onOutbound: async (b, m, a) => ({ args: a }) }, client: client2, logger: { info() {}, warn() {} } });
blockCh.start();
const d2 = [];
blockCh.bySession.set("x", { agent: { followup: (m) => d2.push(m) } });
await blockCh.handleEvent(evOther);
A("闸门拦截时不投递", d2.length === 0 && blockCh.describe().counts.blocked === 1, blockCh.describe().counts);

const chat = [...ch.chats.values()][0];
const callBefore = calls.length;
ch.onSessionEvent({ header: { id: chat.sid } }, { type: "assistant/message", data: { message: { content: [{ type: "text", text: "嗯，我在。" }] } } });
await new Promise((r) => setTimeout(r, 20));
A("模型回复发回 QQ", calls.length > callBefore && calls[calls.length - 1][0] === "send_group_msg", calls.slice(callBefore));
A("回复文本正确", calls[calls.length - 1][1].message.at(-1).data.text === "嗯，我在。", calls[calls.length - 1][1].message);
const callBefore2 = calls.length;
ch.onSessionEvent({ header: { id: "不认识的会话" } }, { type: "assistant/message", data: { message: { content: [{ type: "text", text: "x" }] } } });
A("陌生会话不回声", calls.length === callBefore2);
A("通道 describe 自建标记", ch.describe().selfHosted === true);

// ── 8. 闸门真身能认 onebot raw ──
const G = await import(base + "lib/gate.js");
const gate = G.createGate({ getConfig: loadConfig, saveConfig, diagRef: { counts: {} }, logger: { warn() {}, info() {} }, getClient: () => null });
const rawOne = { __onebot: true, scope: "c2c", peer: "10001", sender: "10001", content: "你好", msgId: "1", attachments: [], mentions: [] };
const blocked = await gate.onInbound(bot, rawOne);
A("闸门认 onebot raw（不在白名单 → 拦）", blocked === true, blocked);
const cfg2 = loadConfig(); cfg2.scope.dmUsers = ["10001"]; saveConfig(cfg2);
const outArgs = await gate.onOutbound(bot, "sendText", [{ scope: "c2c", targetId: "10001", msgId: "1" }, "你好 [[sticker:无语]]"]);
A("出站剥标记", outArgs.args[1].indexOf("[[sticker") < 0, outArgs.args[1]);

console.log("=== 自建 OneBot 通道测试 ===");
let fail = 0;
for (const [n, pass, e] of ok) { console.log((pass ? "OK  " : "FAIL ") + n + (pass ? "" : "   " + JSON.stringify(e))); if (!pass) fail++ }
console.log(fail ? ("失败 " + fail + "/" + ok.length) : ("全部通过 " + ok.length + "/" + ok.length));
process.exit(fail ? 1 : 0);