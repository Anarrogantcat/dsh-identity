import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
process.env.DSH_HOME = 'C:/Users/Ranmi/AppData/Local/Temp/dsh-test-chain';
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
const HOME = process.env.DSH_HOME;
try { rmSync(HOME, { recursive: true, force: true }) } catch {}
mkdirSync(HOME + "/profiles/desktop", { recursive: true });
writeFileSync(HOME + "/profiles/desktop/cordis.patch.yml", "- id: im-qqbot\n  config:\n    appId: '1905982004'\n    appSecret: dummy-secret-for-test\n", "utf8");
const base = new URL('../', import.meta.url).href;
const { createGate } = await import(base + "lib/gate.js");
const { loadConfig, saveConfig, clone, DEFAULTS } = await import(base + "lib/config.js");
const S = await import(base + "lib/state.js");
const { ensureDirs } = await import(base + "lib/store.js");
ensureDirs();
const reset = () => Object.assign(S.state, { muted:{}, muteCalls:{}, cooldown:{}, windows:{}, counters:{}, nm:{}, spokeAt:{}, seen:[], replyTo:{} });
const cfg = clone(DEFAULTS);
cfg.scope.groups = ["G1"]; cfg.roles.owners = ["U-OWNER"];
Object.assign(cfg.frequency, {
  naturalMode: true, aliases: ["大肥鱼","鲸鱼娘"], probabilityPercent: 0,
  selfGapSec: 20, chainWindowSec: 120, naturalCooldownSec: 120, naturalPerHour: 8, naturalPerDay: 30,
  quietEnabled: false, cooldownGroupSec: 90, cooldownMentionSec: 0,
  perMinuteGlobal: 999, perMinuteGroup: 999, perMinuteUser: 999, typingEnabled: false,
  triggerAlias: true, triggerQuestion: false, triggerRandom: false, fitJudge: false,
});
cfg.memory.enabled = false; cfg.profile.enabled = false; cfg.sticker.enabled = false; cfg.learn.enabled = false; cfg.integration.linkMood = false;
saveConfig(cfg); reset();
const bot = { deriveReplyTarget: () => ({ scope:'group', targetId:'G1', msgId:'m' }), sendText: async()=>{}, sendMarkdown: async()=>{}, sendImage: async()=>{} };
const gate = createGate({ getConfig: loadConfig, saveConfig, diagRef:{ counts:{} }, onBot(){}, logger:{ info(){}, warn(){}, error(){} } });
let n = 0;
const send = (text, sender) => gate.onInbound(bot, { group_openid:"G1", author:{ member_openid: sender ?? "U2", member_role:"member" }, content:text, id:"m" + (++n) });
const ok = [];
// 0) 群里先有一段正常对话
ok.push(["叫小名第一句 → 放行", (await send("大肥鱼 在吗", "U2")) === false]);
// 她"说完"（模拟：markSpoke 由出站触发，这里手动设 spokeAt 让 selfGap/冷却成立）
S.markSpoke("g:G1"); S.state.cooldown["group:G1"] = Date.now() + 90 * 1000; S.markReplyTo("G1", "U2");
// 1) 同一个人接着说（没叫名字）→ 连续对话，放行
ok.push(["同一个人接着说 → 放行（连续对话）", (await send("那你觉得谁能赢", "U2")) === false]);
// 2) 换个人说、也没叫名字 → 群里冷却还在，挡住
ok.push(["换个人闲聊 → 挡（没叫她）", (await send("今天天气不错", "U3")) === true]);
// 3) 换个人但叫了她 → 放行（点名优先）
ok.push(["换个人叫她名字 → 放行", (await send("鲸鱼娘 你怎么看", "U3")) === false]);
// 4) 冷却期内叫她 → 也放行（点名不吃群冷却）
ok.push(["90 秒冷却期内叫她 → 放行", (await send("大肥鱼 再分析下", "U4")) === false]);
// 5) 窗口外的同一个人 → 不算连续对话
S.state.replyTo["G1"] = { sender: "U9", at: Date.now() - 10 * 60 * 1000 };
ok.push(["窗口过期 → 不再算连续对话", (await send("随便说说", "U9")) === true]);
// 6) 连续对话也不越过每分钟上限
S.state.cooldown["group:G1"] = 0; S.markReplyTo("G1", "U7");
const c2 = loadConfig(); c2.frequency.perMinuteUser = 3; saveConfig(c2);
S.state.windows["u:U7"] = Array.from({ length: 3 }, () => Date.now());
ok.push(["不再按每人每分钟上限拦截", (await send("接着说", "U7")) === false]);
console.log("=== 连续对话 / 被点名必答 测试 ===");
let fail = 0;
for (const [name, pass] of ok) { console.log((pass ? "OK  " : "FAIL ") + name); if (!pass) fail++ }
console.log(fail ? ("失败 " + fail) : "全部通过");
process.exit(fail ? 1 : 0);
