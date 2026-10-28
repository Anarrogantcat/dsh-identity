import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
process.env.DSH_HOME = 'C:/Users/Ranmi/AppData/Local/Temp/dsh-test-human';
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
const HOME = process.env.DSH_HOME;
try { rmSync(HOME, { recursive: true, force: true }) } catch {}
mkdirSync(HOME + "/profiles/desktop", { recursive: true });
writeFileSync(HOME + "/profiles/desktop/cordis.patch.yml", "- id: im-qqbot\n  config:\n    appId: '1905982004'\n    appSecret: dummy\n", "utf8");
const base = new URL('../', import.meta.url).href;
const { ensureDirs } = await import(base + "lib/store.js");
ensureDirs();
const M = await import(base + "lib/moodlocal.js");
const T = await import(base + "lib/mood.js");
const B = await import(base + "lib/bond.js");
const { clone, DEFAULTS } = await import(base + "lib/config.js");
const ok = []; const C = (n, c, e) => ok.push([n, !!c, e]);
const cfg = clone(DEFAULTS);
// 1) 被骂会生气
M.resetLocalMood();
for (let i = 0; i < 3; i++) M.noteLocalMood('笨蛋废物，滚啊', { role: 'member', by: '小明' });
let s = M.readLocalMood();
let tone = T.moodToneOf(s);
C("被骂会积累 anger", (s.dims.anger ?? 0) > 0.5, s.dims);
C("语气变成生气", tone && tone.tone === "生气", tone && tone.tone);
C("生气规则含「不接梗」", tone && tone.rules.some((r) => /不接梗/.test(r)), tone && tone.rules);
C("生气时不会同时甜", (s.dims.sweet ?? 0) < 1, s.dims);
// 2) 被夸会压回去
for (let i = 0; i < 6; i++) M.noteLocalMood('谢谢你，好厉害好可爱', { role: 'owner', by: '染喵' });
s = M.readLocalMood();
tone = T.moodToneOf(s);
C("被夸之后不再是生气", tone && tone.tone !== "生气", tone && tone.tone);
C("anger 被压下去", (s.dims.anger ?? 0) < 0.6, s.dims);
C("记下了最后是谁说的", s.lastBy === "染喵", s.lastBy);
// 3) 关系分
let b1 = null;
for (let i = 0; i < 22; i++) b1 = B.touchBond('G', 'U1', { bond: 0.3, trust: 0.2, last: '夸她' });
let b2 = null;
for (let i = 0; i < 12; i++) b2 = B.touchBond('G', 'U2', { bond: -0.35, trust: -0.3, last: '怼她' });
C("被夸的人 bond 上升", b1.bond > 0, b1);
C("怼她的人 bond 下降", b2.bond < 0, b2);
C("对熟的人提示可以损", /可以损/.test(B.bondHint("G", "U1")), B.bondHint("G", "U1"));
C("对别扭的人提示别贴", /别扭/.test(B.bondHint("G", "U2")), B.bondHint("G", "U2"));
C("从情绪推断关系变化", B.bondFromDims({ anger: 1.6 }).bond < 0);
console.log("=== 更像人（生气/关系/归因）测试 ===");
let fail = 0;
for (const [n, pass, e] of ok) { console.log((pass ? "OK  " : "FAIL ") + n + (pass ? "" : "   " + JSON.stringify(e || {}).slice(0, 180))); if (!pass) fail++; }
console.log(fail ? ("失败 " + fail) : ("全部通过 " + ok.length + "/" + ok.length));
await new Promise((r) => setTimeout(r, 150));
process.exitCode = fail ? 1 : 0;
