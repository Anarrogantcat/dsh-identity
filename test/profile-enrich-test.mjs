import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
process.env.DSH_HOME = 'C:/Users/Ranmi/AppData/Local/Temp/dsh-test-profile2';
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
const HOME = process.env.DSH_HOME;
try { rmSync(HOME, { recursive: true, force: true }) } catch {}
mkdirSync(HOME + "/profiles/desktop", { recursive: true });
writeFileSync(HOME + "/profiles/desktop/cordis.patch.yml", "- id: im-qqbot\n  config:\n    appId: '1905982004'\n    appSecret: dummy\n", "utf8");
const base = new URL('../', import.meta.url).href;
const { ensureDirs } = await import(base + "lib/store.js");
ensureDirs();
const P = await import(base + "lib/profile.js");
const { clone, DEFAULTS } = await import(base + "lib/config.js");
const cfg = clone(DEFAULTS);
cfg.profile.minMsgs7d = 5;
const G = '830148935';
const ok = []; const T = (n, c, e) => ok.push([n, !!c, e]);
// A：短句 + 省略号 + 常找她 + 爱逗她，聊电竞
for (let i = 0; i < 8; i++) P.record(cfg, G, 'A1', '哈哈傻鱼又来了……', true, { mentions: ['穿云'] });
for (let i = 0; i < 4; i++) P.record(cfg, G, 'A1', '今天LPL谁打谁', false, {});
// B：长句 + 夸她 + 聊生活
for (let i = 0; i < 6; i++) P.record(cfg, G, 'B2', '我觉得今天这个版本改动挺大的，下路对线强度完全不一样了，你们觉得呢？', true, {});
for (let i = 0; i < 3; i++) P.record(cfg, G, 'B2', '谢谢大肥鱼好厉害', false, {});
P.induce(G, cfg);
const list = P.listMembers(G);
const a = list.find((m) => m.uid === 'A1');
const b = list.find((m) => m.uid === 'B2');
T("A 有风格标签（短句/省略号）", !!(a && a.tags.some((t) => t.text === "短句党" || t.text === "爱用省略号")), a && a.tags);
T("A 被标成爱逗她", !!(a && a.tags.some((t) => t.text === "爱逗她")), a && a.tags.map((t) => t.text));
T("A 兴趣里有电竞", !!(a && (a.interests.电竞 || 0) > 0), a && a.interests);
T("B 被标成爱说长句", !!(b && b.tags.some((t) => t.text === "爱说长句")), b && b.tags.map((t) => t.text));
T("B 对她挺客气", !!(b && b.tags.some((t) => t.text === "对她挺客气")), b && b.tags.map((t) => t.text));
T("标签带置信度", !!(a && a.tags.every((t) => t.conf > 0 && t.conf <= 0.95)), a && a.tags);
const rel = P.relations ? P.relations(G) : null;
T("关系里有 A>穿云 的计数", !rel || (rel["A1>穿云"] || 0) >= 1, rel);
T("traits 与 tags 同步", !!(a && a.traits && a.traits.length && a.traits[0] === a.tags[0].text), a && a.traits);
console.log("=== 画像增强 测试 ===");
let fail = 0;
for (const [n, pass, e] of ok) { console.log((pass ? "OK  " : "FAIL ") + n + (pass ? "" : "   " + JSON.stringify(e).slice(0,200))); if (!pass) fail++; }
console.log(fail ? ("失败 " + fail) : ("全部通过 " + ok.length + "/" + ok.length));
process.exit(fail ? 1 : 0);
