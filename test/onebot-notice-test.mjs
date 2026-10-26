process.env.DSH_HOME = 'C:/Users/Ranmi/AppData/Local/Temp/dsh-test-ob-notice';
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
const HOME = process.env.DSH_HOME;
try { rmSync(HOME, { recursive: true, force: true }) } catch {}
mkdirSync(HOME + "/profiles/desktop", { recursive: true });
writeFileSync(HOME + "/profiles/desktop/cordis.patch.yml", "- id: im-qqbot\n  config:\n    appId: '1905982004'\n    appSecret: dummy\n", "utf8");
const base = "file:///C:/Users/Ranmi/.dsh/profiles/desktop/node_modules/dsh-qqbot-refine/";
const N = await import(base + "lib/onebot-inbound.js");
const CH = await import(base + "lib/onebot-channel.js");
const A = await import(base + "lib/admin.js");
const { loadConfig, saveConfig, clone, DEFAULTS } = await import(base + "lib/config.js");
const { ensureDirs } = await import(base + "lib/store.js");
ensureDirs();

const ok = [];
const T = (n, c, e) => ok.push([n, !!c, e]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const setCfg = (mut) => { const c = clone(DEFAULTS); mut(c); saveConfig(c); return c }; 
const calls = [];
const client = { connected: true, url: "ws://t", call: async (a, pms) => { calls.push([a, pms]); if (a === "get_group_member_list") return [{ user_id: 1, card: "甲", nickname: "a", role: "member" }]; return {} }, onEvent: () => () => {}, ping: async () => 1 };

// ── 1. 事件分类 ──
T("撤回事件分类", N.classifyNotice({ post_type: "notice", notice_type: "group_recall", group_id: 1, user_id: 2, operator_id: 2, message_id: 9 }).kind === "recall");
T("戳一戳分类", N.classifyNotice({ post_type: "notice", notice_type: "notify", sub_type: "poke", group_id: 1, user_id: 2, target_id: 3 }).kind === "poke");
T("进群分类", N.classifyNotice({ post_type: "notice", notice_type: "group_increase", group_id: 1, user_id: 2 }).kind === "member_join");
T("自己被踢单独分类", N.classifyNotice({ post_type: "notice", notice_type: "group_decrease", group_id: 1, user_id: 99, self_id: 99 }).kind === "self_leave");
T("禁言分类", N.classifyNotice({ post_type: "notice", notice_type: "group_ban", group_id: 1, user_id: 3, duration: 60 }).kind === "ban");
T("表情回应分类", N.classifyNotice({ post_type: "notice", notice_type: "group_reaction", group_id: 1, user_id: 3, code: "128077", count: 2 }).kind === "reaction");
T("非 notice 返回 null", N.classifyNotice({ post_type: "message" }) === null);

// ── 2. 合并转发展开 ──
const fwd = { messages: [ { sender: { card: "甲" }, content: [{ type: "text", data: { text: "第一句" } }] }, { sender: { nickname: "乙" }, content: [{ type: "text", data: { text: "第二句" } }, { type: "image", data: {} }] } ] };
const ft = N.flattenForward(fwd);
T("合并转发拍平为多行", ft.includes("甲：第一句") && ft.includes("乙：第二句") && ft.includes("[图片]"), ft);
T("合并转发带标题", ft.startsWith("[合并转发]"), ft);
T("空转发不抛", N.flattenForward(null) === "");

// ── 3. 戳一戳话术 ──
T("戳一戳有回复话术", N.POKE_REPLIES.length >= 3 && N.POKE_REPLIES.includes(N.pickPokeReply(() => 0)));
T("撤回过滤自己撤回自己", N.shouldRecordRecall({ kind: "recall", msgId: "9", uid: "1", operatorId: "1" }, "1") === false);
T("别人撤回要记", N.shouldRecordRecall({ kind: "recall", msgId: "9", uid: "2", operatorId: "2" }, "1") === true);

// ── 4. 通道：撤回后不再答 ──
setCfg((c) => { c.transport.mode = "onebot"; c.scope.groups = []; });
const dispatched = [];
const fakeAgents = { get: () => null, resume: async () => { throw new Error("no") }, create: async ({ sessionId }) => ({ agent: { session: { id: sessionId }, followup: (m) => dispatched.push(m) }, dispose: async () => {} }) };
const hooks = { onUserMessage: null, onMissed: null, onReaction: null, onPoke: null };
const ctx = { get: (n) => (n === "agents" ? fakeAgents : null), on: () => () => {} };
const gateOk = { onInbound: async () => false, onOutbound: async (b, m, a) => ({ args: a }) };
const ch = new CH.OneBotChannel({ ctx, gate: gateOk, client, logger: { info() {}, warn() {} }, hooks });
ch.selfId = "690618714";
ch.start();
await ch.handleEvent({ post_type: "message", message_type: "group", group_id: 778, user_id: 5, message_id: 1001, sender: { nickname: "甲" }, message: [{ type: "text", data: { text: "在吗" } }] });
T("普通消息照常投递", dispatched.length === 1, dispatched.length);
await ch.handleEvent({ post_type: "notice", notice_type: "group_recall", group_id: 778, user_id: 5, operator_id: 5, message_id: 1001 });
T("撤回被记账", ch.recalled.has("1001") === true);
await ch.handleEvent({ post_type: "message", message_type: "group", group_id: 778, user_id: 5, message_id: 1001, sender: { nickname: "甲" }, message: [{ type: "text", data: { text: "在吗" } }] });
T("同一 id 重投不重复答", dispatched.length === 1, dispatched.length);

// ── 5. 戳 / 表情 / 进群 ──
let poked = 0, reacted = 0;
ch.hooks.onPoke = () => { poked += 1 };
ch.hooks.onReaction = () => { reacted += 1 };
const beforeSend = calls.length;
await ch.handleEvent({ post_type: "notice", notice_type: "notify", sub_type: "poke", group_id: 778, user_id: 5, target_id: 690618714, message_id: 0 });
T("被戳会回一句", calls.length > beforeSend && calls[calls.length - 1][0] === "send_group_msg", calls.slice(beforeSend).map((c) => c[0]));
T("戳事件触发 hook", poked === 1);
await ch.handleEvent({ post_type: "notice", notice_type: "group_reaction", group_id: 778, user_id: 5, code: "128077", count: 1, message_id: 1001 });
T("表情回应触发 hook", reacted === 1);
calls.length = 0;
setCfg((c) => { c.transport.mode = "onebot" });
await ch.handleEvent({ post_type: "notice", notice_type: "group_increase", group_id: 778, user_id: 6 });
T("进退群触发成员刷新", calls.some((c) => c[0] === "get_group_member_list"), calls.map((c) => c[0]));
T("notice 计数", ch.describe().counts.notices >= 4, ch.describe().counts);

// ── 6. 自己被禁言 → 闭麦 ──
setCfg((c) => { c.transport.mode = "onebot" });
await ch.handleEvent({ post_type: "notice", notice_type: "group_ban", group_id: 778, user_id: 690618714, operator_id: 9, duration: 120 });
const { muteInfo } = await import(base + "lib/state.js");
T("被禁言自动闭麦", !!muteInfo("778"), muteInfo("778"));

// ── 7. 群管 / 互动动作（onebot）──
setCfg((c) => { c.transport.mode = "onebot" });
calls.length = 0;
let r = await A.mute(client, 778, 5, 120);
T("禁言调用 set_group_ban", r.ok && calls.some((c) => c[0] === "set_group_ban" && c[1].duration === 120), calls);
r = await A.recall(client, 1001);
T("撤回调用 delete_msg", r.ok && calls.some((c) => c[0] === "delete_msg" && c[1].message_id === 1001));
r = await A.kick(client, 778, 5, true);
T("踢人调用 set_group_kick", r.ok && calls.some((c) => c[0] === "set_group_kick" && c[1].reject_add_request === true));
r = await A.setCard(client, 778, 5, "新名片");
T("改名片调用 set_group_card", r.ok && calls.some((c) => c[0] === "set_group_card" && c[1].card === "新名片"));
r = await A.react(client, 1001, 76);
T("贴表情调用 set_msg_emoji_like", r.ok && calls.some((c) => c[0] === "set_msg_emoji_like"));
// 官方模式：能力位挡掉
setCfg((c) => { c.transport.mode = "tencent" });
calls.length = 0;
r = await A.mute(client, 778, 5, 120);
T("官方模式群管被能力位挡掉", r.ok === false && r.error.includes("不支持") && calls.length === 0, r);

// ── 8. 引用回复开关 ──
setCfg((c) => { c.transport.mode = "onebot"; c.transport.onebot.quoteReply = false; c.frequency.ignoreSelf = true });
const bot = new CH.OneBotBot({ client, gate: gateOk, logger: { warn() {} } });
calls.length = 0;
await bot.sendText({ scope: "group", targetId: 778, msgId: "1001" }, "不引用");
T("关掉引用就不带 reply 段", calls[calls.length - 1][1].message.every((s) => s.type !== "reply"), calls[calls.length - 1][1].message);

// ── 9. 消息合并窗口 ──
setCfg((c) => { c.transport.mode = "onebot"; c.frequency.mergeWindowSec = 1; c.frequency.ignoreSelf = true });
dispatched.length = 0;
const ch2 = new CH.OneBotChannel({ ctx, gate: gateOk, client, logger: { info() {}, warn() {} } });
ch2.selfId = "690618714";
ch2.start();
const evt = (id, text) => ({ post_type: "message", message_type: "group", group_id: 778, user_id: 7, message_id: id, sender: { nickname: "丙" }, message: [{ type: "text", data: { text } }] });
await ch2.handleEvent(evt(2001, "第一句"));
await ch2.handleEvent(evt(2002, "第二句"));
T("窗口内先不投递", dispatched.length === 0, dispatched.length);
await sleep(1300);
T("窗口结束后合并成一条", dispatched.length === 1 && String(dispatched[0].content[0].text).includes("第一句") && String(dispatched[0].content[0].text).includes("第二句"), dispatched.map((d) => d.content[0].text));

// ── 10. ignoreSelf 开 / 关 ──
setCfg((c) => { c.transport.mode = "onebot"; c.frequency.ignoreSelf = true });
dispatched.length = 0;
const ch3 = new CH.OneBotChannel({ ctx, gate: gateOk, client, logger: { info() {}, warn() {} } });
ch3.selfId = "690618714";
ch3.start();
await ch3.handleEvent({ post_type: "message", message_type: "group", group_id: 778, user_id: 690618714, message_id: 3001, sender: { nickname: "我" }, message: [{ type: "text", data: { text: "回声" } }] });
T("ignoreSelf 开着忽略自己的消息", dispatched.length === 0, dispatched.length);
setCfg((c) => { c.transport.mode = "onebot"; c.frequency.ignoreSelf = false });
dispatched.length = 0;
const ch4 = new CH.OneBotChannel({ ctx, gate: gateOk, client, logger: { info() {}, warn() {} } });
ch4.selfId = "690618714";
ch4.start();
await ch4.handleEvent({ post_type: "message", message_type: "group", group_id: 778, user_id: 690618714, message_id: 3002, sender: { nickname: "我" }, message: [{ type: "text", data: { text: "回声" } }] });
T("ignoreSelf 关掉就照收（调试用）", dispatched.length === 1, dispatched.length);

console.log("=== 入站事件 / 群管 / 合并 / 回声 测试 ===");
let fail = 0;
for (const [n, pass, e] of ok) { console.log((pass ? "OK  " : "FAIL ") + n + (pass ? "" : "   " + JSON.stringify(e))); if (!pass) fail++ }
console.log(fail ? ("失败 " + fail + "/" + ok.length) : ("全部通过 " + ok.length + "/" + ok.length));
process.exit(fail ? 1 : 0);