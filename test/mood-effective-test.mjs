import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
process.env.DSH_HOME = 'C:/Users/Ranmi/AppData/Local/Temp/dsh-test-moodx';
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
const HOME = process.env.DSH_HOME;
try { rmSync(HOME, { recursive: true, force: true }) } catch {}
mkdirSync(HOME + "/profiles/desktop", { recursive: true });
writeFileSync(HOME + "/profiles/desktop/cordis.patch.yml", "- id: im-qqbot\n  config:\n    appId: '1905982004'\n    appSecret: dummy\n", "utf8");
const base = pathToFileURL(join(homedir(), '.dsh', 'profiles', 'desktop', 'node_modules', 'dsh-qqbot-refine')).href + '/';
const { ensureDirs } = await import(base + "lib/store.js");
ensureDirs();
const M = await import(base + "lib/moodlocal.js");
const T = await import(base + "lib/mood.js");
const ok = []; const C = (n, c, e) => ok.push([n, !!c, e]);
// 1) 连续被夸：应该偏开心，而且 sad 被压下去
M.resetLocalMood();
for (let i = 0; i < 8; i++) M.noteLocalMood('谢谢大肥鱼，好厉害，好可爱', { role: 'owner' });
let s = M.readLocalMood();
let tone = T.moodToneOf(s);
C("连着被夸 → 评分偏高", s.mood >= 60, { mood: s.mood, dims: s.dims });
C("被夸时不会同时高难过", (s.dims.sad ?? 0) < 2, s.dims);
C("语气是松快/平和，不是低落", tone && tone.tone !== "低落", tone && tone.tone);
// 2) 连续被骂：评分掉下来，语气转低落
for (let i = 0; i < 8; i++) M.noteLocalMood('笨蛋废物，烦死了，闭嘴', { role: 'owner' });
s = M.readLocalMood();
tone = T.moodToneOf(s);
C("连着被骂 → 评分掉到 40 以下", s.mood < 40, { mood: s.mood, dims: s.dims });
C("被骂之后语气变冲（生气或低落）", tone && (tone.tone === "生气" || tone.tone === "低落"), tone && tone.tone);
C("生气/低落都有明确的收敛规则", tone && tone.rules.length >= 2, tone && tone.rules);
// 3) 被动「有人接话」会回一点
const before = s.mood;
M.noteLocalMood('', { kind: 'reacted' });
s = M.readLocalMood();
C("有人接她的话 → 分数回升", s.mood >= before, { before, after: s.mood });
// 4) 注入文本可读
const block = T.moodBlock(tone);
C("心情块能进系统提示", block.includes("# 这会儿的心情") && block.includes("/100"), block.slice(0, 80));
C("主动发言倍率随心情走", T.proactiveFactor({ mood: 90 }) > T.proactiveFactor({ mood: 10 }));
console.log("=== 心情真的生效 测试 ===");
let fail = 0;
for (const [n, pass, e] of ok) { console.log((pass ? "OK  " : "FAIL ") + n + (pass ? "" : "   " + JSON.stringify(e || {}).slice(0, 180))); if (!pass) fail++; }
console.log(fail ? ("失败 " + fail) : ("全部通过 " + ok.length + "/" + ok.length));
await new Promise((r) => setTimeout(r, 150));
process.exitCode = fail ? 1 : 0;
