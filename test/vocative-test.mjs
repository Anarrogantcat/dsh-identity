import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
process.env.DSH_HOME = process.env.DSH_HOME || 'C:/dsh-test-temp/dsh-test-voc';
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
const HOME = process.env.DSH_HOME;
try { rmSync(HOME, { recursive: true, force: true }) } catch {}
mkdirSync(HOME + "/profiles/desktop", { recursive: true });
writeFileSync(HOME + "/profiles/desktop/cordis.patch.yml", "- id: im-qqbot\n  config:\n    appId: '1905982004'\n    appSecret: dummy\n", "utf8");
const base = new URL('../', import.meta.url).href;
const { createGate } = await import(base + "lib/gate.js");
const { loadConfig, saveConfig, clone, DEFAULTS } = await import(base + "lib/config.js");
const S = await import(base + "lib/state.js");
const { ensureDirs } = await import(base + "lib/store.js");
ensureDirs();
const reset = () => Object.assign(S.state, { muted:{}, muteCalls:{}, cooldown:{}, windows:{}, counters:{}, nm:{}, spokeAt:{}, seen:[] });
const cfg = clone(DEFAULTS);
cfg.scope.groups = ['G1']; cfg.roles.owners = ['U-OWNER'];
Object.assign(cfg.frequency, {
  naturalMode: true, aliases: ['大肥鱼','肥鱼','鲸鱼娘'], probabilityPercent: 0,
  selfGapSec: 0, naturalCooldownSec: 0, naturalPerHour: 99, naturalPerDay: 99,
  quietEnabled: false, cooldownGroupSec: 0, cooldownMentionSec: 0,
  perMinuteGlobal: 999, perMinuteGroup: 999, perMinuteUser: 999, typingEnabled: false,
  triggerAlias: true, triggerQuestion: false, triggerRandom: false, fitJudge: false,
});
cfg.memory.enabled = false; cfg.profile.enabled = false; cfg.sticker.enabled = false; cfg.learn.enabled = false; cfg.integration.linkMood = false;
saveConfig(cfg); reset();
const bot = { deriveReplyTarget: () => ({ scope:'group', targetId:'G1', msgId:'m' }), sendText: async()=>{}, sendMarkdown: async()=>{}, sendImage: async()=>{} };
const gate = createGate({ getConfig: loadConfig, saveConfig, diagRef:{ counts:{} }, onBot(){}, logger:{ info(){}, warn(){}, error(){} } });
const send = (content, id, extra) => gate.onInbound(bot, Object.assign({ __onebot: true, scope:'group', peer:'G1', sender:'U2', senderName:'染喵', content, msgId:id, attachments:[], mentions:[] }, extra || {}));
const ok = [];
const T = (n, c, e) => ok.push([n, !!c, e]);
// 1) 只是把名字当话题，而且 @ 了别人 → 不接（true=拦）
T("「@穿云 有大肥鱼的图没」不接", (await send("@穿云 有大肥鱼的图没", "v1", { mentionsOther: [{ id: "10002", name: "穿云" }] })) === true);
T("「大肥鱼的图发我一下」也不接", (await send("大肥鱼的图发我一下", "v2")) === true);
T("「大肥鱼表情包有吗」不接", (await send("大肥鱼表情包有吗", "v3")) === true);
// 2) 真的在叫她 → 接（false=放行）
T("「大肥鱼在吗」要接", (await send("大肥鱼在吗", "v4")) === false);
T("「@穿云 大肥鱼你别理他」要接", (await send("@穿云 大肥鱼你别理他", "v5", { mentionsOther: [{ id: "10002", name: "穿云" }] })) === false);
T("「鲸鱼娘 帮我看看」要接", (await send("鲸鱼娘 帮我看看", "v6")) === false);
T("被真正 @ 到一定接", (await send("在吗", "v7", { mentions: [{ bot: true }] })) === false);
// 3) 明确 @ 别人、又没叫她：即使刚跟她聊过，也要完全闭嘴
S.markReplyTo('G1', 'U2')
T("@别人且没叫她 → 连续话也不接", (await send("@梅塔特隆 图片", "v8", { mentionsOther: [{ id: "10086", name: "梅塔特隆" }] })) === true);
T("@别人但叫了她名字 → 还是接", (await send("@梅塔特隆 大肥鱼你看这个", "v9", { mentionsOther: [{ id: "10086", name: "梅塔特隆" }] })) === false);
console.log("=== 叫人 vs 提话题 测试 ===");
let fail = 0;
for (const [n, pass, e] of ok) { console.log((pass ? "OK  " : "FAIL ") + n + (pass ? "" : "   " + JSON.stringify(e))); if (!pass) fail++; }
console.log(fail ? ("失败 " + fail + "/" + ok.length) : ("全部通过 " + ok.length + "/" + ok.length));
process.exit(fail ? 1 : 0);
