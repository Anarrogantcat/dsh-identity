import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
process.env.DSH_HOME = 'C:/Users/Ranmi/AppData/Local/Temp/dsh-test-moodsw';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
try { rmSync(process.env.DSH_HOME, { recursive: true, force: true }) } catch {}
mkdirSync(process.env.DSH_HOME + "/profiles/desktop", { recursive: true });
const base = new URL('../', import.meta.url).href;
const mood = await import(base + "lib/mood.js");
const { loadConfig, saveConfig, clone, DEFAULTS, FIELDS } = await import(base + "lib/config.js");
const persona = await import(base + "lib/persona.js");
const { apply } = await import(base + "index.js");
const { ensureDirs, peerKey, dirs } = await import(base + "lib/store.js");
ensureDirs();
// 心情唯一来源：本地 moodlocal.json（第三方插件读取器已移除）
const writeMood = (dims, ageHours = 0) => writeFileSync(join(dirs.root, 'moodlocal.json'), JSON.stringify({ dims, at: Date.now() - ageHours * 3600000 }));
const ok = [];
writeMood({ happy: 9, calm: 5 });
const sections = new Map();
const scope = { logger: console, effect: (fn) => { const d = fn(); return typeof d === "function" ? d : () => {} }, webServer: { register: () => () => {} }, systemPrompt: { section: (s) => { sections.set(s.name, s); return () => sections.delete(s.name) } } };
const ctx = { logger: console, inject: (n, cb) => cb(scope), effect: (fn) => fn() };
const c = clone(DEFAULTS);
c.scope.groups = ["G1"]; c.roles.owners = ["U-OWNER"]; c.ui.markers = true;
saveConfig(c);
await apply(ctx, {});
await new Promise(r => setTimeout(r, 600));
const sec = sections.get('qqbot-refine:identity');
const ctxSec = sections.get('qqbot-refine:context');
const sid = await persona.sessionIdFor('1905982004', 'group', 'G1');
persona.rememberSession(sid, peerKey('group','G1'), 'group', 'G1');
const ctxObj = { session: { id: sid } };
const on = await sec.text(ctxObj);
ok.push(["总开关开 → 有心情段", /这会儿的心情/.test(on)]);
const off = loadConfig(); off.integration.linkMood = false; saveConfig(off);
const t1 = await sec.text(ctxObj);
ok.push(["总开关关 → 心情段消失", !/这会儿的心情/.test(t1)]);
ok.push(["总开关关 → 上下文段仍保留可用标记", /\[\[sticker:auto\]\]/.test(await ctxSec.text(ctxObj))]);
const off2 = loadConfig(); off2.integration.linkMood = true; off2.integration.moodInPrompt = false; saveConfig(off2);
const t2 = await sec.text(ctxObj);
ok.push(["关 moodInPrompt → 只关语气，不影响别的心情联动", !/这会儿的心情/.test(t2) && mood.probabilityFactor(mood.readMood()) > 1, mood.probabilityFactor(mood.readMood())]);
// 恢复语气注入，再验证「本地没数据」与「本地有信号」
const on2 = loadConfig(); on2.integration.moodInPrompt = true; saveConfig(on2);
// 本地引擎：不写文件就没有心情（不假装有情绪）
rmSync(join(dirs.root, 'moodlocal.json'), { force: true });
ok.push(["本地没数据 → 没有心情（诚实为 null）", mood.readMood() === null]);
ok.push(["本地没数据 → 概率不缩放", mood.probabilityFactor(mood.readMood()) === 1]);
ok.push(["本地没数据 → 不做语气", mood.moodToneOf(mood.readMood()) === null]);
const t3 = await sec.text(ctxObj);
ok.push(["本地没数据 → 人设不带心情", !/这会儿的心情/.test(t3)]);
// 本地有信号 → 立刻顶上，而不是等第三方插件
const localMod = await import(base + "lib/moodlocal.js");
localMod.resetLocalMood();
localMod.noteLocalMood("大肥鱼你好厉害");
const t4 = await sec.text(ctxObj);
ok.push(["本地有信号 → 人设带心情", /这会儿的心情/.test(t4)]);
writeMood({ happy: 9, calm: 5 });
const fresh = mood.readMood();
ok.push(["刚写入的心情有效", !fresh.stale && mood.moodToneOf(fresh).tone === '松快']);
// 本地引擎会随时间回落（不需要「插件过期」那套）
const high = localMod.localScore();
const decayed = localMod.localScore(Date.now() + 24 * 3600 * 1000);
ok.push(["24 小时后向 50 回落", decayed < high && decayed >= 50 && decayed <= 100, [high, decayed]]);
// 面板与字段
const cfgFields = FIELDS.map(f => f.k);
ok.push(["面板有 5 个心情开关", ["integration.linkMood","integration.moodInPrompt","integration.moodProactive","integration.linkMoodProbability","integration.linkMoodVoice"].every(k => cfgFields.includes(k)), cfgFields.filter(k=>k.startsWith("integration."))]);
ok.push(["已移除心情来源下拉（只认本地）", !cfgFields.includes("integration.moodSource")]);
const lbl = FIELDS.find(f => f.k === "integration.linkMood");
ok.push(["总开关标签写清楚了", /总开关/.test(lbl.l) && /本地引擎/.test(lbl.hint) && /不读任何插件/.test(lbl.hint), lbl]);
const panel = readFileSync(new URL('../panel.html', import.meta.url), "utf8");
ok.push(["面板常用区露出手开关", ["integration.moodInPrompt","integration.moodProactive","integration.linkMoodProbability","integration.linkMoodVoice"].every(k => panel.includes(k))]);
console.log("=== 心情总开关 / 本地引擎 测试 ===");
let fail = 0;
for (const [n, pass, extra] of ok) { console.log((pass ? "OK  " : "FAIL ") + n + (pass ? "" : "   " + JSON.stringify(extra))); if (!pass) fail++ }
console.log(fail ? ("失败 " + fail) : "全部通过");
process.exit(fail ? 1 : 0);
