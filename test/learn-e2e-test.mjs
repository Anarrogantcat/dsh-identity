process.env.DSH_HOME = 'C:/Users/Ranmi/AppData/Local/Temp/dsh-test-learn2';
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
const HOME = process.env.DSH_HOME;
try { rmSync(HOME, { recursive: true, force: true }) } catch {}
mkdirSync(HOME + "/profiles/desktop", { recursive: true });
writeFileSync(HOME + "/profiles/desktop/cordis.patch.yml", "- id: im-qqbot\n  config:\n    appId: '1905982004'\n    appSecret: dummy-secret-for-test\n", "utf8");
const base = "file:///C:/Users/Ranmi/.dsh/profiles/desktop/node_modules/dsh-qqbot-refine/";
const { createGate } = await import(base + "lib/gate.js");
const learn = await import(base + "lib/learn.js");
const { loadConfig, saveConfig, clone, DEFAULTS } = await import(base + "lib/config.js");
const { ensureDirs, peerKey } = await import(base + "lib/store.js");
const { apply } = await import(base + "index.js");
const persona = await import(base + "lib/persona.js");
const S = await import(base + "lib/state.js");
ensureDirs();
const reset = () => Object.assign(S.state, { muted:{}, muteCalls:{}, cooldown:{}, windows:{}, counters:{}, nm:{}, spokeAt:{}, seen:[] });
const c = clone(DEFAULTS);
c.scope.groups = ["G1"]; c.roles.owners = ["U-OWNER"];
Object.assign(c.frequency, { mentionOnlyGroups:false, naturalMode:true, aliases:["大肥鱼"], probabilityPercent:0, quietEnabled:false, cooldownGroupSec:0, cooldownMentionSec:0, perMinuteGlobal:999, perMinuteGroup:999, perMinuteUser:999, naturalCooldownSec:0, naturalPerHour:999, naturalPerDay:999, selfGapSec:0, typingEnabled:false });
c.memory.enabled = false; c.profile.enabled = false; c.sticker.enabled = false; c.persona.enabled = true;
saveConfig(c); reset();
const said = [];
const bot = { deriveReplyTarget: () => ({ scope:"group", targetId:"G1", msgId:"m" }), sendText: async (t, b) => said.push(b), sendMarkdown: async()=>{}, sendImage: async()=>{} };
const gate = createGate({ getConfig: loadConfig, saveConfig, diagRef:{ counts:{} }, onBot(){}, logger:{ info(){}, warn(){}, error(){} } });
const pk = peerKey('group', 'G1');
learn.forgetRules(pk);
const ok = [];
// Owner 教规矩
await gate.onInbound(bot, { group_openid:"G1", author:{ member_openid:"U-OWNER", member_role:"owner" }, content:"以后不要用敬语", id:"m1" });
ok.push(["Owner 的规矩被记下", learn.rulesFor(pk).includes("不要用敬语"), learn.rulesFor(pk)]);
// 普通群友说同样的话 → 不记
await gate.onInbound(bot, { group_openid:"G1", author:{ member_openid:"U-MEMBER", member_role:"member" }, content:"以后不要用敬语啊", id:"m2" });
ok.push(["普通群友教不动", learn.rulesFor(pk).length === 1, learn.rulesFor(pk)]);
// 出站记一次「等反应」，随后有人接 → 正反馈
const before = learn.replyRate(pk);
await gate.onOutbound(bot, 'sendText', [{ scope:"group", targetId:"G1" }, "嗯，知道了"]);
const mid = learn.replyRate(pk);
ok.push(["她说的话被记一次", mid.sent === before.sent + 1, mid]);
await gate.onInbound(bot, { group_openid:"G1", author:{ member_openid:"U-MEMBER", member_role:"member" }, content:"哈哈哈哈", id:"m3" });
ok.push(["有人接 → 计一次正反馈", learn.replyRate(pk).reacted === before.reacted + 1, learn.replyRate(pk)]);
// 人设段注入规矩
const sections = new Map();
const scope = { logger: console, effect: (fn) => { const d = fn(); return typeof d === "function" ? d : () => {} }, webServer: { register: () => () => {} }, systemPrompt: { section: (s) => { sections.set(s.name, s); return () => sections.delete(s.name) } } };
const ctx = { logger: console, inject: (n, cb) => cb(scope), effect: (fn) => fn() };
await apply(ctx, {});
await new Promise(r => setTimeout(r, 600));
const sid = await persona.sessionIdFor('1905982004', 'group', 'G1');
persona.rememberSession(sid, pk, 'group', 'G1');
const body = await sections.get('qqbot-refine:persona').text({ session: { id: sid } });
ok.push(["规矩进了人设段", body.includes("这个群学到的规矩") && body.includes("不要用敬语"), body.slice(-160)]);
ok.push(["规矩要求别念出来", body.includes("照做，别念出来")]);
// 关掉开关就不注入
const c2 = loadConfig(); c2.learn.injectRules = false; saveConfig(c2);
const body2 = await sections.get('qqbot-refine:persona').text({ session: { id: sid } });
ok.push(["关掉 injectRules → 不注入", !body2.includes("这个群学到的规矩")]);
console.log("=== 学习 端到端测试 ===");
let fail = 0;
for (const [n, pass, extra] of ok) { console.log((pass ? "OK  " : "FAIL ") + n + (pass ? "" : "   " + JSON.stringify(extra))); if (!pass) fail++ }
console.log(fail ? ("失败 " + fail) : "全部通过");
process.exit(fail ? 1 : 0);
