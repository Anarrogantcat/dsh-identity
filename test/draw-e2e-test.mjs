// 重测试：真的会调 ComfyUI 生成图片（内存尖峰 ~10GB），全量回归默认跳过，手动跑请设 QQBOT_DRAW_E2E=1
if (process.env.QQBOT_DRAW_E2E !== "1") {
  console.log("跳过：draw-e2e 会真的调 ComfyUI 生成图片（设 QQBOT_DRAW_E2E=1 可手动跑）");
  process.exit(0);
}
import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
process.env.DSH_HOME = process.env.DSH_HOME || 'C:/dsh-test-temp/dsh-test-draw4';
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
const HOME = process.env.DSH_HOME;
try { rmSync(HOME, { recursive: true, force: true }) } catch {}
mkdirSync(HOME + "/profiles/desktop", { recursive: true });
writeFileSync(HOME + "/profiles/desktop/cordis.patch.yml", "- id: im-qqbot\n  config:\n    appId: '1905982004'\n    appSecret: dummy\n", "utf8");
const base = new URL('../', import.meta.url).href;
const { createGate } = await import(base + "lib/gate.js");
const { loadConfig, saveConfig, clone, DEFAULTS } = await import(base + "lib/config.js");
const { ensureDirs } = await import(base + "lib/store.js");
ensureDirs();
const cfg = clone(DEFAULTS);
cfg.scope.groups = ['GD']; cfg.roles.owners = ['U-OWNER'];
Object.assign(cfg.frequency, { naturalMode: true, aliases: ['大肥鱼'], ownerPriority: 'always', probabilityPercent: 0, quietEnabled: false, cooldownGroupSec: 0, cooldownMentionSec: 0, perMinuteGlobal: 999, perMinuteGroup: 999, perMinuteUser: 999 });
cfg.draw.members = true; cfg.draw.confirm = true; cfg.draw.search = false;
cfg.memory.enabled = false; cfg.profile.enabled = false; cfg.sticker.enabled = false; cfg.learn.enabled = false; cfg.integration.linkMood = false; cfg.voice.enabled = false;
saveConfig(cfg);
const texts = []; const images = [];
const bot = { deriveReplyTarget: () => ({ scope: 'group', targetId: 'GD', msgId: 'm' }), sendText: async (t, s) => { texts.push(String(s)) }, sendMarkdown: async () => {}, sendImage: async (t, s) => { images.push(s) } };
const warns = [];
const gate = createGate({ getConfig: loadConfig, saveConfig, diagRef: { counts: {} }, onBot() {}, logger: { info() {}, warn() { warns.push(String(arguments[0])) } } });
const send = (content, id) => gate.onInbound(bot, { __onebot: true, scope: 'group', peer: 'GD', sender: 'U-MEMBER', senderName: '群友', content, msgId: id, attachments: [], mentions: [] });
const ok = []; const T = (n, c, e) => ok.push([n, !!c, e]);
await send('画条大肥鱼', 'd1');
T("「画条大肥鱼」给出草稿确认（不立刻画）", texts.some((s) => s.includes("我准备这样画")) && images.length === 0, texts.slice(-1));
await send('画吧', 'd2');
await new Promise((r) => setTimeout(r, 2500));
T("确认后真的发图", images.length >= 1, { images, texts: texts.slice(-2) });
const p = images[0] && (images[0].localPath || images[0].url);
// 再说一次「生成一张图」——没有任何描述，也应该走草稿
texts.length = 0; images.length = 0;
await send('生成一张图', 'd3');
T("「生成一张图」（无描述）也出草稿", texts.some((s) => s.includes("我准备这样画")), texts.slice(-1));
await send('画吧', 'd4');
await new Promise((r) => setTimeout(r, 2500));
T("无描述确认后也能出图", images.length >= 1, { images: images.length });
T("发的是本地 PNG", !!p && /\.png$/i.test(String(p)), p);
console.log("warns:", warns.slice(0, 4));
console.log("texts:", texts.slice(0, 3));
console.log("=== 群友画图 端到端 测试 ===");
let fail = 0;
for (const [n, pass, e] of ok) { console.log((pass ? "OK  " : "FAIL ") + n + (pass ? "" : "   " + JSON.stringify(e || {}).slice(0, 200))); if (!pass) fail++; }
console.log(fail ? ("失败 " + fail) : ("全部通过 " + ok.length + "/" + ok.length));
await new Promise((r) => setTimeout(r, 300));
process.exitCode = fail ? 1 : 0;
