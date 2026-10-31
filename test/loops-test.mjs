process.env.DSH_HOME = process.env.DSH_HOME || 'C:/dsh-test-temp/dsh-test-loops';
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
const HOME = process.env.DSH_HOME;
try { rmSync(HOME, { recursive: true, force: true }) } catch {}
mkdirSync(HOME + "/profiles/desktop", { recursive: true });
writeFileSync(HOME + "/profiles/desktop/cordis.patch.yml", "- id: im-qqbot\n  config:\n    appId: '1905982004'\n    appSecret: dummy\n", "utf8");
const { pathToFileURL } = await import("node:url");
const { homedir } = await import("node:os");
const { join } = await import("node:path");
const base = new URL('../', import.meta.url).href;
const { ensureDirs } = await import(base + "lib/store.js");
ensureDirs();
const M = await import(base + "lib/moodlocal.js");
const T = await import(base + "lib/mood.js");
const K = await import(base + "lib/knowledge.js");
const ok = []; const A = (n, c, e) => ok.push([n, !!c, e]);
// 1) 画图画成功 → 成就感（心情与亲近度回环）
M.resetLocalMood();
M.noteLocalMood('', { kind: 'draw' });
let s = M.readLocalMood();
A("画完一张图 → 得意/开心上升", (s.dims.pride ?? 0) > 0.5 && (s.dims.happy ?? 0) > 0, s.dims);
// 2) 说了一段语音 → 小开心
M.resetLocalMood();
M.noteLocalMood('', { kind: 'voice' });
s = M.readLocalMood();
A("发一段语音 → 开心/甜上升", (s.dims.happy ?? 0) > 0 && (s.dims.sweet ?? 0) > 0, s.dims);
// 3) 知识库回写：追加后能被检索到
const name = K.kbNameForPeer('100000003');
const w1 = K.saveKbFile(name, '\n## 2026-10-27 群里确认\n本群禁止刷屏\n', { append: true });
const hits = K.searchKnowledge('禁止刷屏', name.replace(/\.md$/, ''), { minScore: 0 });
A("写回的知识库能被检索", w1.ok === true && hits.length >= 1, { w1, name, hits: hits.length });
// 4) 成本：上下文与召回都被限制在保守值
const { DEFAULTS } = await import(base + "lib/config.js");
A("上下文条数默认不超过 6", Number(DEFAULTS.transport.onebot.contextLines ?? 8) <= 6, DEFAULTS.transport.onebot.contextLines);
console.log("=== 三个缺口回环 测试 ===");
let fail = 0;
for (const [n, pass, e] of ok) { console.log((pass ? "OK  " : "FAIL ") + n + (pass ? "" : "   " + JSON.stringify(e || {}).slice(0, 160))); if (!pass) fail++; }
console.log(fail ? ("失败 " + fail) : ("全部通过 " + ok.length + "/" + ok.length));
await new Promise((r) => setTimeout(r, 150));
process.exitCode = fail ? 1 : 0;
