import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
process.env.DSH_HOME = 'C:/Users/Ranmi/AppData/Local/Temp/dsh-test-sticker';
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
const HOME = process.env.DSH_HOME;
try { rmSync(HOME, { recursive: true, force: true }) } catch {}
const h = HOME + "/profiles/desktop"; mkdirSync(h, { recursive: true });
writeFileSync(h + "/cordis.patch.yml", "- id: im-qqbot\n  config:\n    appId: '1905982004'\n    appSecret: dummy-secret-for-test\n", "utf8");
const base = new URL('../', import.meta.url).href;
const { createGate } = await import(base + "lib/gate.js");
const { loadConfig, saveConfig, clone, DEFAULTS } = await import(base + "lib/config.js");
const S = await import(base + "lib/state.js");
const { ensureDirs, dirs } = await import(base + "lib/store.js");
ensureDirs();
const reset = () => { Object.assign(S.state, { muted:{}, muteCalls:{}, cooldown:{}, windows:{}, counters:{}, nm:{}, spokeAt:{}, seen:[] }) };

// 图库：2 张「开心」+ 1 张「无语」
writeFileSync(dirs.stickers + "/index.json", JSON.stringify({ items: [
  { id:"aaa", url:"https://example.test/a.png", large:"https://example.test/a.webp", tags:[], moods:["开心"], source:"fisharchive", path:null },
  { id:"bbb", url:"https://example.test/b.png", large:"https://example.test/b.webp", tags:[], moods:["开心"], source:"fisharchive", path:null },
  { id:"ccc", url:"https://example.test/c.png", large:"https://example.test/c.webp", tags:[], moods:["无语"], source:"fisharchive", path:null },
] }, null, 1), "utf8");

const c = clone(DEFAULTS);
c.scope.groups = ["G1"]; c.roles.owners = ["U-OWNER"];
c.sticker.enabled = true; c.sticker.perTurnMax = 1; c.sticker.perGroupDay = 20; c.sticker.dedupeHours = 24;
c.sticker.maxPerMsgMB = 0; // 0 = 允许直接发远程直链（新默认 2MB 会先下载再发，单测里没有网络）
c.privacy.enabled = false; c.integration.linkMood = false;
saveConfig(c); reset();

const images = []; const texts = [];
const bot = {
  deriveReplyTarget: () => ({ scope:"group", targetId:"G1", msgId:"m" }),
  sendText: async (t, body) => { texts.push(body) },
  sendMarkdown: async (t, body) => { texts.push(body) },
  sendImage: async (t, body) => { images.push(body) },
};
const gate = createGate({ getConfig: loadConfig, saveConfig, diagRef:{ counts:{} }, onBot(){}, logger:{ info(){}, warn(){}, error(){} } });
const target = { scope:"group", targetId:"G1" };
const ok = [];

// 1) 模型写了 [[sticker:开心]]
const r1 = await gate.onOutbound(bot, 'sendText', [target, '嘿嘿，好耶 [[sticker:开心]]']);
await new Promise(r => setTimeout(r, 800));
ok.push(["发文字时标记被剥掉", typeof r1?.args?.[1] === 'string' && !r1.args[1].includes("[[sticker:") && r1.args[1].includes("嘿嘿")]);
ok.push(["真的发了一张图", images.length === 1]);
ok.push(["图是「开心」池里的", !!images[0] && /a\.webp|b\.webp/.test(images[0].url ?? "")]);

// 2) [[sticker:auto]] → 按心情（无心情文件时回落 开心）
images.length = 0; texts.length = 0; reset();
await gate.onOutbound(bot, 'sendText', [target, '嗯嗯 [[sticker:auto]]']);
await new Promise(r => setTimeout(r, 800));
ok.push(["auto 也能发", images.length === 1]);

// 3) 情绪不在库里 → 不发图但不报错
images.length = 0; texts.length = 0; reset();
await gate.onOutbound(bot, 'sendText', [target, '噗 [[sticker:兴奋]]']);
await new Promise(r => setTimeout(r, 800));
ok.push(["库里没有的情绪 → 安静不发", images.length === 0]);

// 4) 没有标记 → 不发图
images.length = 0; texts.length = 0; reset();
const r4 = await gate.onOutbound(bot, 'sendText', [target, '普通一句话']);
await new Promise(r => setTimeout(r, 800));
ok.push(["没标记 → 文字原样、不发图", images.length === 0 && r4?.args?.[1] === '普通一句话']);

console.log("=== 表情包发送测试 ===");
let fail = 0;
for (const [n, pass] of ok) { console.log((pass ? "\u2705 " : "\u274c ") + n); if (!pass) fail++ }
console.log(fail ? ("失败 " + fail) : "全部通过");
process.exit(fail ? 1 : 0);
