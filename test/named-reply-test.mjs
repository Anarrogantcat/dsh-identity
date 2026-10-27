import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
process.env.DSH_HOME = 'C:/Users/Ranmi/AppData/Local/Temp/dsh-test-named';
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
const HOME = process.env.DSH_HOME;
try { rmSync(HOME, { recursive: true, force: true }) } catch {}
mkdirSync(HOME + "/profiles/desktop", { recursive: true });
writeFileSync(HOME + "/profiles/desktop/cordis.patch.yml", "- id: im-qqbot\n  config:\n    appId: '1905982004'\n    appSecret: dummy-secret-for-test\n", "utf8");
const base = pathToFileURL(join(homedir(), '.dsh', 'profiles', 'desktop', 'node_modules', 'dsh-qqbot-refine')).href + '/';
const { createGate } = await import(base + "lib/gate.js");
const { loadConfig, saveConfig, clone, DEFAULTS } = await import(base + "lib/config.js");
const S = await import(base + "lib/state.js");
const { ensureDirs } = await import(base + "lib/store.js");
ensureDirs();
const reset = () => Object.assign(S.state, { muted:{}, muteCalls:{}, cooldown:{}, windows:{}, counters:{}, nm:{}, spokeAt:{}, seen:[] });
const cfg = clone(DEFAULTS);
cfg.scope.groups = ['G1']; cfg.roles.owners = ['U-OWNER'];
Object.assign(cfg.frequency, {
  naturalMode: true, aliases: ['大肥鱼','鲸鱼娘'], probabilityPercent: 0,
  selfGapSec: 0, naturalCooldownSec: 120, naturalPerHour: 8, naturalPerDay: 30,
  quietEnabled: false, cooldownGroupSec: 0, cooldownMentionSec: 0,
  perMinuteGlobal: 999, perMinuteGroup: 999, perMinuteUser: 999, typingEnabled: false,
  triggerAlias: true, triggerQuestion: false, triggerRandom: false, fitJudge: false,
});
cfg.memory.enabled = false; cfg.profile.enabled = false; cfg.sticker.enabled = false; cfg.learn.enabled = true;
cfg.integration.linkMood = false;
saveConfig(cfg); reset();
const bot = { deriveReplyTarget: () => ({ scope:'group', targetId:'G1', msgId:'m' }), sendText: async()=>{}, sendMarkdown: async()=>{}, sendImage: async()=>{} };
const gate = createGate({ getConfig: loadConfig, saveConfig, diagRef:{ counts:{} }, onBot(){}, logger:{ info(){}, warn(){}, error(){} } });
const send = (text, id, sender) => gate.onInbound(bot, { group_openid:'G1', author:{ member_openid: sender ?? 'U2', member_role:'member' }, content:text, id });
const ok = [];
// 1) 普通闲聊 → 不接（没有人叫她，概率 0）
ok.push(["闲聊不接", (await send('今天天气不错', 'm1')) === true]);
// 2) 叫小名 → 接（返回 false = 放行给模型）
ok.push(["叫小名就接", (await send('大肥鱼', 'm2')) === false]);
// 3) 刚说完 2 秒，又叫她 → 仍然要接（不被「自然接话冷却」挡）
ok.push(["紧接着再叫也接（跳过自然冷却）", (await send('@鲸鱼娘 发点色图', 'm3')) === false]);
// 4) 不叫她、只提问 → 依旧受冷却/概率限制，不接
ok.push(["换个人闲聊、没叫她 → 还是不接", (await send('你们觉得谁能赢', 'm4', 'U3')) === true]);
// 5) 自然额度用尽也不影响被点名
for (let i = 0; i < 10; i++) await send('随便聊聊' + i, 'x' + i);
ok.push(["额度耗尽后叫名字仍然接", (await send('鲸鱼娘 在吗', 'm5')) === false]);
console.log("=== 被点名必答 测试 ===");
let fail = 0;
for (const [n, pass] of ok) { console.log((pass ? "OK  " : "FAIL ") + n); if (!pass) fail++ }
console.log(fail ? ("失败 " + fail) : "全部通过");
process.exit(fail ? 1 : 0);
