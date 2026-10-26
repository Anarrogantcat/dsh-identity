process.env.DSH_HOME = 'C:/Users/Ranmi/AppData/Local/Temp/dsh-test-home' // __TEST_HOME__ 隔离，绝不写真实配置
import { mkdirSync as _mk, writeFileSync as _wf } from "node:fs";
{ const _h = process.env.DSH_HOME + "/profiles/desktop"; _mk(_h, { recursive: true });
  _wf(_h + "/cordis.patch.yml", "- id: im-qqbot\n  config:\n    appId: '1905982004'\n    appSecret: dummy-secret-for-test\n", "utf8"); }
const base = "file:///C:/Users/Ranmi/.dsh/profiles/desktop/node_modules/dsh-qqbot-refine/";
const { createGate } = await import(base + "lib/gate.js");
const { loadConfig, saveConfig, clone, DEFAULTS } = await import(base + "lib/config.js");
const S = await import(base + "lib/state.js");
const { ensureDirs } = await import(base + "lib/store.js");
ensureDirs(); S.state.muted={}; S.state.muteCalls={}; S.state.nm={}; S.state.seen=[];
const cfg0 = clone(DEFAULTS);
cfg0.scope.groups = ["G1"]; cfg0.scope.dmUsers=["U1"]; cfg0.roles.owners=["U1"];
cfg0.frequency.mentionOnlyGroups = true;
cfg0.frequency.naturalMode = false;
cfg0.frequency.quietEnabled = false;
cfg0.frequency.cooldownMentionSec = 0;
cfg0.frequency.perMinuteGlobal = 999; cfg0.frequency.perMinuteGroup = 999; cfg0.frequency.perMinuteUser = 999;   // 免打扰时段（默认 23:30-08:00）会挡住夜间测试
cfg0.frequency.nonMentionEvery = 3;
cfg0.frequency.cooldownGroupSec = 90;   // 非@冷却很严，抽样应当绕过它
saveConfig(cfg0);

const bot = { deriveReplyTarget: () => ({scope:"group",targetId:"G1",msgId:"m"}), sendText: async()=>{}, sendMarkdown: async()=>{}, sendImage: async()=>{} };
const gate = createGate({ getConfig: loadConfig, saveConfig, diagRef: { counts:{} }, onBot(){}, logger: console });
const raw = (c, u="U2") => ({ group_openid:"G1", author:{member_openid:u}, content:c, id:"m" });
const ok = [];
const res = [];
for (let i=1;i<=6;i++) res.push(await gate.onInbound(bot, raw(`闲聊第 ${i} 句`)));
ok.push(["1-2 条不回", res[0]===true && res[1]===true]);
ok.push(["第 3 条放行", res[2]===false]);
ok.push(["4-5 条不回", res[3]===true && res[4]===true]);
ok.push(["第 6 条放行", res[5]===false]);
const res2 = await gate.onInbound(bot, raw("随便一句"));
ok.push(["第 7 条不回", res2===true]);
const mention = await gate.onInbound(bot, raw(`<@!1905982004> 在吗`));
ok.push(["@ 消息不受 N 影响", mention===false]);

// 关掉 N：全不回
const c2 = loadConfig(); c2.frequency.nonMentionEvery = 0; S.state.nm={}; saveConfig(c2);
const off = await gate.onInbound(bot, raw("没 @ 你"));
ok.push(["N=0 时不回", off===true]);

// 业主豁免
const c3 = loadConfig(); c3.frequency.nonMentionEvery = 0; saveConfig(c3);
const owner = await gate.onInbound(bot, raw("我是主人", "U1"));
ok.push(["Owner 不受限", owner===false]);

saveConfig(clone(DEFAULTS)); S.state.nm={};
console.log("=== 非@每N条 测试 ==="); let fail=0;
for (const [n,p] of ok){ console.log(`${p?"✅":"❌"} ${n}`); if(!p) fail++ }
console.log(fail?`失败 ${fail}`:"全部通过");


