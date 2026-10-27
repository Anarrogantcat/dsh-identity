import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
process.env.DSH_HOME = 'C:/Users/Ranmi/AppData/Local/Temp/dsh-test-msrc';
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
const HOME = process.env.DSH_HOME;
try { rmSync(HOME, { recursive: true, force: true }) } catch {}
mkdirSync(HOME + "/profiles/desktop", { recursive: true });
mkdirSync(HOME + "/feiyu-mood", { recursive: true });
writeFileSync(HOME + "/profiles/desktop/cordis.patch.yml", "- id: im-qqbot\n  config:\n    appId: '1905982004'\n    appSecret: dummy-secret-for-test\n", "utf8");
const base = pathToFileURL(join(homedir(), '.dsh', 'profiles', 'desktop', 'node_modules', 'dsh-qqbot-refine')).href + '/';
const mood = await import(base + "lib/mood.js");
const local = await import(base + "lib/moodlocal.js");
const { loadConfig, saveConfig, clone, DEFAULTS, TABS, FIELDS } = await import(base + "lib/config.js");
const { ensureDirs } = await import(base + "lib/store.js");
ensureDirs();
const writePlugin = (score, dims, ageHours) => writeFileSync(HOME + "/feiyu-mood/state.json", JSON.stringify({ version: 2, lastActive: "fish", moods: { fish: { mood: score, dims, updatedAt: Date.now() - ageHours * 3600000 } } }));
const ok = [];
const cfgOf = (mode) => { const c = clone(DEFAULTS); c.integration.moodSource = mode; return c };
// 0) 默认必须是本地（零依赖），装了第三方也不自动用
ok.push(["默认心情来源是本地", DEFAULTS.integration.moodSource === 'local', DEFAULTS.integration.moodSource]);
const srcField = FIELDS.find((f) => f.k === 'integration.moodSource');
ok.push(["心情来源是下拉框且含 local", srcField && srcField.t === 'select' && (srcField.options || []).some((o) => o.v === 'local'), srcField]);
writePlugin(66, { happy: 3 }, 1);
const defMood = mood.readMood(clone(DEFAULTS));
ok.push(["默认模式下插件文件新鲜也不用它", defMood === null || defMood.source === 'local', defMood]);
// 1) auto：插件新鲜就用插件
writePlugin(88, { happy: 9 }, 1);
const auto1 = mood.readMood(cfgOf('auto'));
ok.push(["auto：插件新鲜 → 用插件", auto1.source === 'plugin' && auto1.mood === 88, auto1]);
// 2) auto：插件过期 → 回落本地
writePlugin(88, { happy: 9 }, 30);
local.resetLocalMood();
local.noteLocalMood("大肥鱼好厉害");
const auto2 = mood.readMood(cfgOf('auto'));
ok.push(["auto：插件过期 → 回落本地", auto2 && auto2.source === 'local' && !auto2.stale, auto2 && auto2.source]);
// 3) 没有插件文件 → 本地
try { rmSync(HOME + "/feiyu-mood/state.json") } catch {}
try { rmSync(HOME + "/storages/dsh-qqbot-refine/moodlocal.json") } catch {}
const auto3 = mood.readMood(cfgOf('auto'));
ok.push(["两边都没数据 → 没有心情（诚实为 null）", auto3 === null, auto3]);
local.resetLocalMood();
local.noteLocalMood("大肥鱼你好厉害");
const auto3b = mood.readMood(cfgOf('auto'));
ok.push(["本地有信号 → 用本地", auto3b && auto3b.source === 'local', auto3b]);
// 4) plugin 模式：过期也照用（但要标记 stale）
writePlugin(70, {}, 30);
const pMode = mood.readMood(cfgOf('plugin'));
ok.push(["plugin 模式过期仍标 stale", pMode.source === 'plugin' && pMode.stale === true, pMode.stale]);
ok.push(["stale 时不产生语气", mood.moodToneOf(pMode) === null]);
// 5) local 模式：永远本地
const lMode = mood.readMood(cfgOf('local'));
ok.push(["local 模式不读插件", lMode.source === 'local']);
// 6) 本地引擎：夸→升，怼→降，衰减回落
local.resetLocalMood();
const s0 = local.localScore();
local.noteLocalMood("大肥鱼你好厉害，好可爱");
const s1 = local.localScore();
local.noteLocalMood("你这个笨蛋废物");
const s2 = local.localScore();
ok.push(["夸她 → 分数上升", s1 > s0, [s0, s1]]);
ok.push(["怼她 → 分数下降", s2 < s1, [s1, s2]]);
ok.push(["单条最多把分数推 10 分（有惯性）", s1 - s0 > 0 && s1 - s0 <= 10, s1 - s0]);
ok.push(["分数夹在 0~100", s2 >= 0 && s2 <= 100, s2]);
const decayed = local.localScore(Date.now() + 24 * 3600 * 1000);
ok.push(["24 小时后向 50 回落一半", Math.abs(decayed - (50 + (s2 - 50) / 2)) < 1.5, [s2, decayed]]);
// 7) 面板：有没有心情页
ok.push(["页签里有「心情」", TABS.some(t => t[0] === 'mood'), TABS.map(t=>t[0])]);
const moodFields = FIELDS.filter(f => f.tab === 'mood').map(f => f.k);
ok.push(["心情字段都挂在心情页", moodFields.includes('integration.linkMood') && moodFields.includes('integration.moodSource'), moodFields]);
const panel = (await import("node:fs")).readFileSync(join(homedir(), '.dsh', 'profiles', 'desktop', 'node_modules', 'dsh-qqbot-refine', 'panel.html'), "utf8");
ok.push(["面板有心情卡片渲染", panel.includes('moodCardHtml')]);
ok.push(["面板能重置本地心情", panel.includes('resetLocal')]);
console.log("=== 心情来源 / 本地兜底 / 心情页 测试 ===");
let fail = 0;
for (const [n, pass, extra] of ok) { console.log((pass ? "OK  " : "FAIL ") + n + (pass ? "" : "   " + JSON.stringify(extra))); if (!pass) fail++ }
console.log(fail ? ("失败 " + fail) : "全部通过");
process.exit(fail ? 1 : 0);
