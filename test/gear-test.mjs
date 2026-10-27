import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
process.env.DSH_HOME = 'C:/Users/Ranmi/AppData/Local/Temp/dsh-test-home' // __TEST_HOME__ 隔离，绝不写真实配置
import { mkdirSync as _mk, writeFileSync as _wf } from "node:fs";
{ const _h = process.env.DSH_HOME + "/profiles/desktop"; _mk(_h, { recursive: true });
  _wf(_h + "/cordis.patch.yml", "- id: im-qqbot\n  config:\n    appId: '1905982004'\n    appSecret: dummy-secret-for-test\n", "utf8"); }
const base = pathToFileURL(join(homedir(), '.dsh', 'profiles', 'desktop', 'node_modules', 'dsh-qqbot-refine')).href + '/';
const { GEARS, gearValues } = await import(base+"lib/gear.js");
const { createGate } = await import(base+"lib/gate.js");
const { loadConfig, saveConfig, clone, DEFAULTS } = await import(base+"lib/config.js");
const S = await import(base+"lib/state.js");
const { ensureDirs } = await import(base+"lib/store.js");
ensureDirs();
const ok=[];
ok.push(["5 个挡位", Object.keys(GEARS).length===5]);
ok.push(["挡位含上限字段", !!gearValues(3).naturalPerHour && !!gearValues(3).naturalPerDay]);
const reset=()=>{S.state.muted={};S.state.muteCalls={};S.state.nm={};S.state.seen=[];S.state.spokeAt={};S.state.windows={};S.state.cooldown={};S.state.counters={}};
const make=(over={})=>{const c=clone(DEFAULTS);c.scope.groups=["G1"];c.scope.dmUsers=["U1"];c.roles.owners=["U1"];
 c.frequency.naturalMode=true;c.frequency.aliases=["大肥鱼"];c.frequency.probabilityPercent=100;
 c.frequency.stickyMin=5;c.frequency.selfGapSec=0;c.frequency.cooldownGroupSec=0;c.frequency.cooldownMentionSec=0;
 c.frequency.perMinuteGlobal=999;c.frequency.perMinuteGroup=999;c.frequency.perMinuteUser=999;c.frequency.quietEnabled=false;
 c.frequency.fitJudge=false;c.frequency.naturalCooldownSec=0;c.frequency.naturalPerHour=3;c.frequency.naturalPerDay=99;
 c.memory.enabled=false;c.profile.enabled=false;c.sticker.enabled=false;
 Object.assign(c.frequency,over);return c};
const bot={deriveReplyTarget:()=>({scope:"group",targetId:"G1",msgId:"m"}),sendText:async()=>{},sendMarkdown:async()=>{},sendImage:async()=>{}};
const gate=createGate({getConfig:loadConfig,saveConfig,diagRef:{counts:{}},onBot(){},logger:console});
const raw=(x,u="U2")=>({group_openid:"G1",author:{member_openid:u},content:x,id:"m"});

saveConfig(make({})); reset();
let pass=0; for(let i=0;i<6;i++){ const r=await gate.onInbound(bot, raw(`闲聊第${i}句`)); if(r===false) pass++ }
ok.push(["每小时上限 3 生效", pass===3]);

saveConfig(make({naturalPerDay:2})); reset();
pass=0; for(let i=0;i<5;i++){ const r=await gate.onInbound(bot, raw(`再说${i}`)); if(r===false) pass++ }
ok.push(["每日上限 2 生效", pass===2]);

saveConfig(make({naturalCooldownSec:600})); reset();
const a=await gate.onInbound(bot, raw("第一句"));
const b2=await gate.onInbound(bot, raw("第二句"));
ok.push(["最小间隔生效", a===false && b2===true]);

saveConfig(make({naturalPerHour:3, naturalCooldownSec:0, cooldownGroupSec:0, cooldownMentionSec:0, perMinuteGlobal:999, perMinuteGroup:999, perMinuteUser:999})); reset();
let mentionPass=0;
for(let i=0;i<5;i++){ const r=await gate.onInbound(bot, raw(`<@!1905982004> 第${i}次叫你`)); if(r===false) mentionPass++ }
ok.push(["@ 不占自然额度", mentionPass===5]);

saveConfig(clone(DEFAULTS)); reset();
console.log("=== 挡位与频率闸测试 ==="); let fail=0;
for(const [n,p] of ok){console.log(`${p?"✅":"❌"} ${n}`); if(!p) fail++}
console.log(fail?`失败 ${fail}`:"全部通过");


// 断言失败要真的算失败（run-all 只看 exit code）
process.exitCode = fail ? 1 : 0;

