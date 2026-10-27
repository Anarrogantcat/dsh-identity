import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
process.env.DSH_HOME = 'C:/Users/Ranmi/AppData/Local/Temp/dsh-test-ownerpri';
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
const HOME = process.env.DSH_HOME;
try { rmSync(HOME, { recursive: true, force: true }) } catch {}
mkdirSync(HOME + "/profiles/desktop", { recursive: true });
writeFileSync(HOME + "/profiles/desktop/cordis.patch.yml", "- id: im-qqbot\n  config:\n    appId: '1905982004'\n    appSecret: dummy\n", "utf8");
const base = pathToFileURL(join(homedir(), '.dsh', 'profiles', 'desktop', 'node_modules', 'dsh-qqbot-refine')).href + '/';
const { createGate } = await import(base + "lib/gate.js");
const { loadConfig, saveConfig, clone, DEFAULTS } = await import(base + "lib/config.js");
const S = await import(base + "lib/state.js");
const { ensureDirs } = await import(base + "lib/store.js");
ensureDirs();
const mkCfg = (mode) => {
  const c = clone(DEFAULTS);
  c.scope.groups = ['GP']; c.roles.owners = ['U-OWNER', 'U-OWNER2'];
  Object.assign(c.frequency, { naturalMode: true, aliases: ['大肥鱼'], probabilityPercent: 0, selfGapSec: 0, naturalCooldownSec: 0, naturalPerHour: 99, naturalPerDay: 99, quietEnabled: false, cooldownGroupSec: 600, cooldownMentionSec: 0, perMinuteGlobal: 999, perMinuteGroup: 2, perMinuteUser: 999, typingEnabled: false, triggerAlias: true, triggerQuestion: false, triggerRandom: false, fitJudge: false, ownerPriority: mode });
  c.memory.enabled = false; c.profile.enabled = false; c.sticker.enabled = false; c.learn.enabled = false; c.integration.linkMood = false; c.voice.enabled = false;
  return c;
};
const reset = () => Object.assign(S.state, { muted: {}, muteCalls: {}, cooldown: {}, windows: {}, counters: {}, nm: {}, spokeAt: {}, seen: [], replyTo: {} });
const bot = { deriveReplyTarget: () => ({ scope: 'group', targetId: 'GP', msgId: 'm' }), sendText: async () => {}, sendMarkdown: async () => {}, sendImage: async () => {} };
const send = (gate, sender, text, id) => gate.onInbound(bot, { __onebot: true, scope: 'group', peer: 'GP', sender, senderName: sender, content: text, msgId: id, attachments: [], mentions: [] });
const ok = []; const T = (n, c, e) => ok.push([n, !!c, e]);
function gateFor(cfg) { return createGate({ getConfig: () => cfg, saveConfig: (x) => saveConfig(x), diagRef: { counts: {} }, onBot() {}, logger: { info() {}, warn() {}, error() {} } }) }
// 1) always：Owner 连发 3 条都放行（不占冷却/总量）
reset(); saveConfig(mkCfg('always'));
let g1 = gateFor(loadConfig());
const r1 = [];
for (let i = 0; i < 3; i++) r1.push(await send(g1, 'U-OWNER', '在吗', 'o' + i));
T("ownerPriority=always：Owner 连发 3 条全放行", r1.every((x) => x === false), r1);
// 2) normal：Owner 的闲聊也走自然判定（概率 0 → 不回）；叫名字照样回
reset(); saveConfig(mkCfg('normal'));
let g2 = gateFor(loadConfig());
const a = await send(g2, 'U-OWNER', '在吗', 'n1');
T('ownerPriority=normal：闲聊也按自然判定挡', a === true, a);
const c1 = await send(g2, 'U-OWNER2', '大肥鱼 在吗', 'n2');
T('ownerPriority=normal：叫名字照样回', c1 === false, c1);
// 3) 普通成员：概率 0 → 一律挡
reset(); saveConfig(mkCfg('always'));
let g3 = gateFor(loadConfig());
const m1 = await send(g3, 'U-MEMBER', '今天好累', 'm1');
T("普通成员仍然按概率挡", m1 === true, m1);
console.log("=== Owner 优先 测试 ===");
let fail = 0;
for (const [n, pass, e] of ok) { console.log((pass ? "OK  " : "FAIL ") + n + (pass ? "" : "   " + JSON.stringify(e))); if (!pass) fail++; }
console.log(fail ? ("失败 " + fail) : ("全部通过 " + ok.length + "/" + ok.length));
process.exit(fail ? 1 : 0);
