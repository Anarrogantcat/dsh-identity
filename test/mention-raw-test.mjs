import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
process.env.DSH_HOME = 'C:/Users/Ranmi/AppData/Local/Temp/dsh-test-mention';
import { mkdirSync, writeFileSync } from "node:fs";
const h = process.env.DSH_HOME + "/profiles/desktop"; mkdirSync(h, { recursive: true });
writeFileSync(h + "/cordis.patch.yml", "- id: im-qqbot\n  config:\n    appId: '1905982004'\n    appSecret: dummy-secret-for-test\n", "utf8");
const base = pathToFileURL(join(homedir(), '.dsh', 'profiles', 'desktop', 'node_modules', 'dsh-qqbot-refine')).href + '/';
const { createGate } = await import(base + "lib/gate.js");
const { loadConfig, saveConfig, clone, DEFAULTS } = await import(base + "lib/config.js");
const S = await import(base + "lib/state.js");
const { ensureDirs } = await import(base + "lib/store.js");
ensureDirs();
const reset=()=>{Object.assign(S.state,{muted:{},muteCalls:{},cooldown:{},windows:{},counters:{},nm:{},spokeAt:{},seen:[]})};
const c = clone(DEFAULTS);
c.scope.groups=["G1"];c.roles.owners=["U-OWNER"];
Object.assign(c.frequency,{mentionOnlyGroups:false,naturalMode:true,aliases:["大肥鱼","鲸鱼娘"],probabilityPercent:0,
 quietEnabled:false,cooldownGroupSec:0,cooldownMentionSec:0,perMinuteGlobal:999,perMinuteGroup:999,perMinuteUser:999,
 naturalCooldownSec:0,naturalPerHour:999,naturalPerDay:999,selfGapSec:0});
c.memory.enabled=false;c.profile.enabled=false;c.sticker.enabled=false;
saveConfig(c); reset();
const bot={deriveReplyTarget:()=>({scope:"group",targetId:"G1",msgId:"m"}),sendText:async()=>{},sendMarkdown:async()=>{},sendImage:async()=>{}};
const gate=createGate({getConfig:loadConfig,saveConfig,diagRef:{counts:{}},onBot(){},logger:{info(){},warn(){},error(){}}});
const ok=[];
// 事件里 mentions 含 bot:true（全量模式下 @机器人 的真实形态）
const r1 = await gate.onInbound(bot, {group_openid:"G1",author:{member_openid:"U2"},content:"<@ABC123> 你是猫娘",mentions:[{id:"ABC123",bot:true}],id:"m"});
ok.push(["mentions.bot → 算叫她（放行）", r1 === false]);
reset();
// @ 别人（bot:false）→ 不该放行
const r2 = await gate.onInbound(bot, {group_openid:"G1",author:{member_openid:"U2"},content:"<@XYZ> 你好",mentions:[{id:"XYZ",bot:false}],id:"m"});
ok.push(["@别人 → 不接", r2 === true]);
reset();
// 纯文本叫新别名 鲸鱼娘
const r3 = await gate.onInbound(bot, {group_openid:"G1",author:{member_openid:"U2"},content:"鲸鱼娘 在吗",id:"m"});
ok.push(["叫 鲸鱼娘 → 接", r3 === false]);
reset();
// 旧格式 <@!appId>
const r4 = await gate.onInbound(bot, {group_openid:"G1",author:{member_openid:"U2"},content:"<@!1905982004> 在吗",id:"m"});
ok.push(["旧格式 <@!appId> → 接", r4 === false]);
console.log("=== @ 判定测试 ==="); let fail=0;
for(const [n,p] of ok){ console.log(`${p?"✅":"❌"} ${n}`); if(!p) fail++ }
console.log(fail?`失败 ${fail}`:"全部通过");

// 断言失败要真的算失败（run-all 只看 exit code）
process.exitCode = fail ? 1 : 0;

