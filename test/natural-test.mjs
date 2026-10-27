import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
process.env.DSH_HOME = 'C:/Users/Ranmi/AppData/Local/Temp/dsh-test-final';
const base=pathToFileURL(join(homedir(), '.dsh', 'profiles', 'desktop', 'node_modules', 'dsh-qqbot-refine', 'lib/')).href;
const { createGate } = await import(base+"gate.js");
const { loadConfig, saveConfig, clone, DEFAULTS } = await import(base+"config.js");
const S = await import(base+"state.js");
const { ensureDirs } = await import(base+"store.js");
ensureDirs();
const reset=()=>{Object.assign(S.state,{muted:{},muteCalls:{},nm:{},seen:[],spokeAt:{},windows:{},cooldown:{},counters:{}})};
const mk=(over={})=>{const c=clone(DEFAULTS);Object.assign(c.scope,{groups:["G1"],dmUsers:["U1"]});c.roles.owners=["U1"];
 Object.assign(c.frequency,{mentionOnlyGroups:false,naturalMode:true,aliases:["大肥鱼"],probabilityPercent:0,stickyMin:5,selfGapSec:0,
 cooldownGroupSec:0,cooldownMentionSec:0,perMinuteGlobal:999,perMinuteGroup:999,perMinuteUser:999,quietEnabled:false,
 naturalCooldownSec:0,naturalPerHour:999,naturalPerDay:999,fitJudge:true,fitThreshold:0.35,directThreshold:0.5});
 Object.assign(c,{memory:{...c.memory,enabled:false},profile:{...c.profile,enabled:false},sticker:{...c.sticker,enabled:false}});
 Object.assign(c.frequency,over);return c};
const bot={deriveReplyTarget:()=>({scope:"group",targetId:"G1",msgId:"m"}),sendText:async()=>{},sendMarkdown:async()=>{},sendImage:async()=>{}};
const gate=createGate({getConfig:loadConfig,saveConfig,diagRef:{counts:{}},onBot(){},logger:console});
const raw=(x,u="U2")=>({group_openid:"G1",author:{member_openid:u},content:x,id:"m"});
const ok=[];
const run=async(over,msg,expect,label)=>{saveConfig(mk(over));reset();const r=await gate.onInbound(bot,raw(msg));ok.push([label,r===!expect])};

await run({}, "大肥鱼在吗", true, "叫小名→接");
await run({}, "今天天气不错", false, "闲聊→不接");
await run({}, "<@!999999> 你俩别吵了", false, "@别人+你俩→不接");
await run({probabilityPercent:100}, "这个报错怎么解决", true, "技术问句(100%)→接");
await run({probabilityPercent:100}, "😀😀", false, "纯表情(100%)→不接");
await run({probabilityPercent:100}, "把那个文件删掉", false, "危险意图→不接");
await run({}, "<@all> 开会了", false, "@全体(无话题)→不接");
// 自然冷却
saveConfig(mk({naturalCooldownSec:600})); reset();
const a=await gate.onInbound(bot,raw("大肥鱼 第一次")); const b2=await gate.onInbound(bot,raw("大肥鱼 第二次"));
ok.push(["自然冷却生效（第二次被挡）", a===false && b2===true]);
// 闭麦
saveConfig(mk({})); reset(); S.setMute("G1", 60000, "U1");
ok.push(["闭麦后普通成员不回", (await gate.onInbound(bot,raw("大肥鱼 在吗")))===true]);
reset();
console.log("=== 最终验收 ==="); let fail=0;
for (const [n,p] of ok){ console.log(`${p?"✅":"❌"} ${n}`); if(!p) fail++ }
console.log(fail?`失败 ${fail}`:"全部通过");
