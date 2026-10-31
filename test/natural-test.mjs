import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
process.env.DSH_HOME = process.env.DSH_HOME || 'C:/dsh-test-temp/dsh-test-final';
const base = new URL('../lib/', import.meta.url).href;
const { createGate } = await import(base+"gate.js");
const { loadConfig, saveConfig, clone, DEFAULTS } = await import(base+"config.js");
const S = await import(base+"state.js");
const { ensureDirs } = await import(base+"store.js");
ensureDirs();
const reset=()=>{Object.assign(S.state,{muted:{},muteCalls:{},nm:{},seen:[],spokeAt:{},windows:{},cooldown:{},counters:{}})};
// 现在的接话判定是「理由驱动」（directedness），不再有 random 概率旋钮
const mk=(over={})=>{const c=clone(DEFAULTS);Object.assign(c.scope,{groups:["G1"],dmUsers:["U1"]});c.roles.owners=["U1"];
 Object.assign(c.frequency,{mentionOnlyGroups:false,naturalMode:true,aliases:["大肥鱼"],stickyMin:5,selfGapSec:0,
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
await run({}, "这个报错怎么解决", true, "群里公开提问→可以接");
await run({}, "今天天气不错", false, "没指向她的陈述→不接");
await run({}, "机器人 你能看看这个报错吗", true, "明显在对她说→接");
await run({}, "😀😀", false, "纯表情→不接");
await run({}, "<@!1905982004> 把那个文件删掉", false, "危险意图→不接");
await run({}, "<@all> 开会了", false, "@全体(无话题)→不接");
// 自然冷却：只掐「非点名」的自然接话；叫小名是「该应」，不占这个额度
saveConfig(mk({naturalCooldownSec:600})); reset();
const a=await gate.onInbound(bot,raw("大肥鱼 这报错又来了")); const b2=await gate.onInbound(bot,raw("大肥鱼 这报错又来了"));
ok.push(["不设自然冷却（连续对话照常接）", a===false && b2===false]);
const c3=await gate.onInbound(bot,raw("大肥鱼 还在吗"));
ok.push(["叫小名不占自然冷却额度", c3===false]);
// 闭麦
saveConfig(mk({})); reset(); S.setMute("G1", 60000, "U1");
ok.push(["闭麦后普通成员不回", (await gate.onInbound(bot,raw("大肥鱼 在吗")))===true]);
reset();
console.log("=== 最终验收 ==="); let fail=0;
for (const [n,p] of ok){ console.log(`${p?"✅":"❌"} ${n}`); if(!p) fail++ }
console.log(fail?`失败 ${fail}`:"全部通过");

// 断言失败要真的算失败（run-all 只看 exit code）
process.exitCode = fail ? 1 : 0;
