import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
process.env.DSH_HOME = 'C:/Users/Ranmi/AppData/Local/Temp/dsh-test-lobs';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
const HOME = process.env.DSH_HOME;
try { rmSync(HOME, { recursive: true, force: true }) } catch {}
mkdirSync(HOME + "/profiles/desktop", { recursive: true });
writeFileSync(HOME + "/profiles/desktop/cordis.patch.yml", "- id: im-qqbot\n  config:\n    appId: '1905982004'\n    appSecret: dummy-secret-for-test\n", "utf8");
const base = new URL('../', import.meta.url).href;
const learn = await import(base + "lib/learn.js");
const { createGate } = await import(base + "lib/gate.js");
const { loadConfig, saveConfig, clone, DEFAULTS } = await import(base + "lib/config.js");
const { ensureDirs, peerKey } = await import(base + "lib/store.js");
const S = await import(base + "lib/state.js");
ensureDirs();
const ok = [];
const pk = peerKey('group', 'G1');
learn.forgetRules(pk);
learn.learnRule({ peerKey: pk, text: '不要用敬语', by: 'U-OWNER' });
learn.learnRule({ peerKey: pk, text: '记住：这个群只聊技术', by: 'U-OWNER' });
const view = learn.learnView(5);
ok.push(["学习视图带规矩原文", view[0].rules.length === 2 && view[0].rules[0]==='不要用敬语', view[0]]);
ok.push(["学习视图带反馈数据", typeof view[0].sent === 'number' && typeof view[0].factor === 'number', view[0]]);
// #学到的 命令
const c = clone(DEFAULTS);
c.scope.groups = ['G1']; c.roles.owners = ['U-OWNER'];
Object.assign(c.frequency, { typingEnabled:false, quietEnabled:false, cooldownGroupSec:0, cooldownMentionSec:0, perMinuteGlobal:999, perMinuteGroup:999, perMinuteUser:999, probabilityPercent:0, naturalMode:false, mentionOnlyGroups:false, nonMentionEvery:0 });
c.memory.enabled=false; c.profile.enabled=false; c.sticker.enabled=false; c.persona.enabled=false;
saveConfig(c); Object.assign(S.state, { muted:{}, muteCalls:{}, cooldown:{}, windows:{}, counters:{}, nm:{}, spokeAt:{}, seen:[] });
const said = [];
const bot = { deriveReplyTarget: () => ({ scope:'group', targetId:'G1', msgId:'m' }), sendText: async (t,b) => said.push(b), sendMarkdown: async(t,b)=>said.push(b), sendImage: async()=>{} };
const gate = createGate({ getConfig: loadConfig, saveConfig, diagRef:{ counts:{} }, onBot(){}, logger:{ info(){}, warn(){}, error(){} } });
await gate.onInbound(bot, { group_openid:'G1', author:{ member_openid:'U-OWNER', member_role:'owner' }, content:'#学到的', id:'m1' });
const msg = said.join('\n');
ok.push(["#学到的 列出规矩", msg.includes('不要用敬语') && msg.includes('记住：这个群只聊技术'), msg.slice(0,120)]);
ok.push(["#学到的 带接话统计", /接话统计/.test(msg), msg.slice(-80)]);
// 普通群友看不到
said.length = 0;
await gate.onInbound(bot, { group_openid:'G1', author:{ member_openid:'U-MEMBER', member_role:'member' }, content:'#学到的', id:'m2' });
ok.push(["普通群友 #学到的 被挡", said.length === 0, said]);
// 面板快照字段 + 卡片
const panel = readFileSync(new URL('../panel.html', import.meta.url), "utf8");
ok.push(["面板有学习卡片", panel.includes('learnCardHtml') && panel.includes('STATE.learnDetail')]);
const idx = readFileSync(new URL('../index.js', import.meta.url), "utf8");
ok.push(["快照输出 learnDetail", idx.includes('learnDetail:')]);
console.log("=== 学习可见性 测试 ===");
let fail = 0;
for (const [n, pass, extra] of ok) { console.log((pass ? "OK  " : "FAIL ") + n + (pass ? "" : "   " + JSON.stringify(extra))); if (!pass) fail++ }
console.log(fail ? ("失败 " + fail) : "全部通过");
process.exit(fail ? 1 : 0);
