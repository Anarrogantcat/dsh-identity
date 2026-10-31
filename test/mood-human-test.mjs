import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
process.env.DSH_HOME = process.env.DSH_HOME || 'C:/dsh-test-temp/dsh-test-mhuman';
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
const HOME = process.env.DSH_HOME;
try { rmSync(HOME, { recursive: true, force: true }) } catch {}
mkdirSync(HOME + "/profiles/desktop", { recursive: true });
const base = new URL('../', import.meta.url).href;
const M = await import(base + "lib/moodlocal.js");
const { ensureDirs } = await import(base + "lib/store.js");
ensureDirs();
const ok = [];
const near = (a, b, tol = 0.8) => Math.abs(a - b) <= tol;
// 1) 多维：夸 → 开心+甜；怼 → 难过；倾诉 → 心疼+担心；吃醋由骂人带一点
M.resetLocalMood();
M.noteLocalMood("大肥鱼你好厉害，好可爱", { role: 'owner' });
let m = M.readLocalMood();
ok.push(["被夸：开心有值", m.dims.happy > 0, m.dims]);
ok.push(["被夸：甜也有值", m.dims.sweet > 0, m.dims]);
ok.push(["被夸：分数上去了", m.mood > 50, m.mood]);
const afterPraise = m.mood;
M.noteLocalMood("你个笨蛋，闭嘴", { role: 'member' });
m = M.readLocalMood();
ok.push(["被怼：难过有值", m.dims.sad > 0, m.dims]);
ok.push(["被怼：分数掉下来", m.mood < afterPraise, [afterPraise, m.mood]]);
M.resetLocalMood();
M.noteLocalMood("今天好累，想哭", { role: 'member' });
m = M.readLocalMood();
ok.push(["有人倾诉 → 心疼+担心", m.dims.heartache > 0 && m.dims.worry > 0, m.dims]);
// 2) 惯性：一句话最多推 2 分/维度，不会一秒翻脸
M.resetLocalMood();
M.noteLocalMood("你真是个废物，滚", { role: 'owner' });
m = M.readLocalMood();
ok.push(["单维度单次不超过 2 分", m.dims.sad <= 2.0001, m.dims.sad]);
ok.push(["分数变化不超过 8 分", Math.abs(m.mood - 50) <= 16, m.mood]);
// 3) 会恢复：开心 6 小时半衰期
M.resetLocalMood();
M.noteLocalMood("谢谢，真靠谱", { role: 'owner' });
const h0 = M.readLocalMood().dims.happy;
const h6 = M.readLocalMood(Date.now() + 6 * 3600000).dims.happy;
ok.push(["6 小时后开心减半", near(h6, h0 / 2), [h0, h6]]);
const h24 = M.readLocalMood(Date.now() + 24 * 3600000).dims.happy;
ok.push(["一天后基本平静", h24 < 0.3, h24]);
// 4) 互动结果也会影响心情
M.resetLocalMood();
const before = M.localScore();
M.noteLocalMood('', { kind: 'reacted' });
const afterReact = M.localScore();
M.noteLocalMood('', { kind: 'ignored' });
const afterIgnored = M.localScore();
ok.push(["有人接话 → 心情变好", afterReact > before, [before, afterReact]]);
ok.push(["被冷落 → 心情变差", afterIgnored < afterReact, [afterReact, afterIgnored]]);
// 5) 分数由维度算出来（不是独立变量）
const dims = { happy: 5, calm: 2, sweet: 3, heartache: 0, worry: 0, sad: 0, jealous: 0 };
ok.push(["分数 = 公式结果", M.scoreOf(dims) === 50 + 3*5 + 2*3 + 1*2, M.scoreOf(dims)]);
ok.push(["吃醋压分最狠", M.scoreOf({ ...dims, happy: 0, sweet: 0, calm: 0, jealous: 6 }) === 32, M.scoreOf({ ...dims, happy: 0, sweet: 0, calm: 0, jealous: 6 })]);
ok.push(["分数夹在 0~100", M.scoreOf({ sad: 99 }) === 0 && M.scoreOf({ happy: 99 }) === 100]);
// 6) 没有记录时是 null（不假装有心情）
rmSync(HOME + "/storages/dsh-qqbot-refine/moodlocal.json");
ok.push(["没记录 → null", M.readLocalMood() === null]);
console.log("=== 像人的心情引擎 测试 ===");
let fail = 0;
for (const [n, pass, extra] of ok) { console.log((pass ? "OK  " : "FAIL ") + n + (pass ? "" : "   " + JSON.stringify(extra))); if (!pass) fail++ }
console.log(fail ? ("失败 " + fail) : "全部通过");
process.exit(fail ? 1 : 0);
