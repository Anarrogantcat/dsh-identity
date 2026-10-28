import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
process.env.DSH_HOME = 'C:/Users/Ranmi/AppData/Local/Temp/dsh-test-home' // __TEST_HOME__ 隔离，绝不写真实配置
const base = new URL('../', import.meta.url).href;
const { createGate } = await import(base + "lib/gate.js");
const { loadConfig, saveConfig, clone, DEFAULTS } = await import(base + "lib/config.js");
const S = await import(base + "lib/state.js");
const { ensureDirs } = await import(base + "lib/store.js");
ensureDirs();
S.state.muted = {}; S.state.muteCalls = {}; S.state.seen = [];
saveConfig(clone(DEFAULTS));

const sent = [];
const bot = {
  deriveReplyTarget: () => ({ scope: "group", targetId: "G1", msgId: "m1" }),
  sendText: async (t, s) => { sent.push(s) },
  sendMarkdown: async (t, s) => { sent.push(s) },
  sendImage: async () => {},
};
const gate = createGate({ getConfig: loadConfig, saveConfig, diagRef: { counts: {} }, onBot: () => {}, logger: console });

const ok = [];
const rawGroup = (content, sender = "U1") => ({ group_openid: "G1", author: { member_openid: sender }, content, id: "m" });

// 1) 无码 #绑定本群（群未授权）
let blocked = await gate.onInbound(bot, rawGroup("#绑定本群"));
ok.push(["未授权群 #绑定本群 被回复提示", blocked === true && sent.some((s) => s.includes("绑定码"))]);
ok.push(["群仍不在白名单", loadConfig().scope.groups.length === 0]);

// 2) 生成绑定码并绑定 owner
const b = S.newBind("owner", 10);
blocked = await gate.onInbound(bot, rawGroup(`#绑定 ${b.code.toLowerCase()}`));
const cfg = loadConfig();
ok.push(["绑定码（小写输入也可）", cfg.roles.owners.includes("U1")]);
ok.push(["绑定后群进白名单", cfg.scope.groups.includes("G1")]);
ok.push(["绑定后进私聊白名单", cfg.scope.dmUsers.includes("U1")]);
ok.push(["码一次性", S.getBind() === null]);

// 3) 错码
sent.length = 0;
blocked = await gate.onInbound(bot, rawGroup("#绑定 XXXX2345", "U2"));
ok.push(["错码提示", sent.some((s) => s.includes("不对或已过期"))]);

// 4) 已授权群里 #绑定本群
sent.length = 0;
await gate.onInbound(bot, rawGroup("#绑定本群", "U1"));
ok.push(["已授权群提示已在白名单", sent.some((s) => s.includes("已经在白名单"))]);

// 5) 非白名单普通消息仍被拦
const before = S.state.seen.length;
blocked = await gate.onInbound(bot, rawGroup("随便说句话", "U9"));
ok.push(["陌生群消息仍拦截", blocked === true]);

saveConfig(clone(DEFAULTS)); S.clearBind();
console.log("=== 绑定流程测试 ==="); let fail = 0;
for (const [n, p] of ok) { console.log(`${p ? "✅" : "❌"} ${n}`); if (!p) fail++ }
console.log(fail ? `失败 ${fail}` : "全部通过");


// 断言失败要真的算失败（run-all 只看 exit code）
process.exitCode = fail ? 1 : 0;

