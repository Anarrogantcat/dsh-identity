import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
process.env.DSH_HOME = 'C:/Users/Ranmi/AppData/Local/Temp/dsh-test-attach';
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
const HOME = process.env.DSH_HOME;
try { rmSync(HOME, { recursive: true, force: true }) } catch {}
const h = HOME + "/profiles/desktop"; mkdirSync(h, { recursive: true });
writeFileSync(h + "/cordis.patch.yml", "- id: im-qqbot\n  config:\n    appId: '1905982004'\n    appSecret: dummy-secret-for-test\n", "utf8");
const base = new URL('../', import.meta.url).href;
const { createGate } = await import(base + "lib/gate.js");
const { loadConfig, saveConfig, clone, DEFAULTS } = await import(base + "lib/config.js");
const S = await import(base + "lib/state.js");
const { ensureDirs } = await import(base + "lib/store.js");
ensureDirs();
const reset = () => { Object.assign(S.state, { muted:{}, muteCalls:{}, cooldown:{}, windows:{}, counters:{}, nm:{}, spokeAt:{}, seen:[] }) };
const c = clone(DEFAULTS);
c.scope.groups = ["G1"]; c.roles.owners = ["U-OWNER"];
Object.assign(c.frequency, { mentionOnlyGroups:false, naturalMode:true, aliases:["大肥鱼"], probabilityPercent:0,
  quietEnabled:false, cooldownGroupSec:0, cooldownMentionSec:0, perMinuteGlobal:999, perMinuteGroup:999, perMinuteUser:999,
  naturalCooldownSec:0, naturalPerHour:999, naturalPerDay:999, selfGapSec:0 });
c.memory.enabled = false; c.profile.enabled = false;
c.sticker.enabled = true; c.sticker.collectEnabled = true; c.sticker.collectPerGroupDay = 30;
saveConfig(c); reset();

const fetched = [];
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6300010000050001" + "0d0a2db4" + "0000000049454e44ae426082", "hex");
const isMedia = (u) => /multimedia|\/a\.png|\/b\.jpg|silk\.silk|v\.wav/.test(String(u));
globalThis.fetch = async (url) => { if (isMedia(url)) fetched.push(String(url)); return { ok:true, arrayBuffer: async () => PNG } };

const bot = { deriveReplyTarget: () => ({ scope:"group", targetId:"G1", msgId:"m" }), sendText: async()=>{}, sendMarkdown: async()=>{}, sendImage: async()=>{} };
const gate = createGate({ getConfig: loadConfig, saveConfig, diagRef:{ counts:{} }, onBot(){}, logger:{ info(){}, warn(){}, error(){} } });
const ok = [];

// 1) 图片只在 msg_elements 里（引用消息的真实形态）
await gate.onInbound(bot, { group_openid:"G1", author:{ member_openid:"U2" }, content:"看这个", id:"m1",
  msg_elements:[{ msg_idx:"0", attachments:[{ content_type:"image/png", url:"https://multimedia.nt.qq.com.cn/a.png?sig=1" }] }] });
await new Promise(r => setTimeout(r, 400));
ok.push(["msg_elements 里的图被收集", fetched.includes("https://multimedia.nt.qq.com.cn/a.png?sig=1")]);

// 2) 顶层 + msg_elements 同一张图 → 只下载一次（去重）
fetched.length = 0; reset();
await gate.onInbound(bot, { group_openid:"G1", author:{ member_openid:"U2" }, content:"重复图", id:"m2",
  attachments:[{ content_type:"image/jpeg", url:"https://multimedia.nt.qq.com.cn/b.jpg" }],
  msg_elements:[{ msg_idx:"0", attachments:[{ content_type:"image/jpeg", url:"https://multimedia.nt.qq.com.cn/b.jpg" }] }] });
await new Promise(r => setTimeout(r, 400));
ok.push(["同一张图只收一次（去重）", fetched.filter(u => u.includes("b.jpg")).length === 1]);

// 3) 语音/文件附件不该当表情收
fetched.length = 0; reset();
await gate.onInbound(bot, { group_openid:"G1", author:{ member_openid:"U2" }, content:"语音", id:"m3",
  msg_elements:[{ msg_idx:"0", attachments:[{ content_type:"voice", url:"https://x/silk.silk", voice_wav_url:"https://x/v.wav" }] }] });
await new Promise(r => setTimeout(r, 400));
ok.push(["语音附件不收集", fetched.length === 0]);

// 4) 纯文字消息不触发下载
fetched.length = 0; reset();
await gate.onInbound(bot, { group_openid:"G1", author:{ member_openid:"U2" }, content:"大肥鱼 你好", id:"m4" });
await new Promise(r => setTimeout(r, 300));
ok.push(["纯文字不触发下载", fetched.length === 0]);

console.log("=== 附件收集测试 ===");
let fail = 0;
for (const [n, p2] of ok) { console.log((p2 ? "\u2705 " : "\u274c ") + n); if (!p2) fail++ }
console.log(fail ? ("失败 " + fail) : "全部通过");
process.exit(fail ? 1 : 0);

