import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
process.env.DSH_HOME = 'C:/Users/Ranmi/AppData/Local/Temp/dsh-test-msrc';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
const HOME = process.env.DSH_HOME;
try { rmSync(HOME, { recursive: true, force: true }) } catch {}
mkdirSync(HOME + "/profiles/desktop", { recursive: true });
writeFileSync(HOME + "/profiles/desktop/cordis.patch.yml", "- id: im-qqbot\n  config:\n    appId: '1905982004'\n    appSecret: dummy-secret-for-test\n", "utf8");
const base = new URL('../', import.meta.url).href;
const mood = await import(base + "lib/mood.js");
const local = await import(base + "lib/moodlocal.js");
const { loadConfig, saveConfig, clone, DEFAULTS, TABS, FIELDS } = await import(base + "lib/config.js");
const { ensureDirs, dirs } = await import(base + "lib/store.js");
ensureDirs();
const ok = [];
const localPath = join(dirs.root, 'moodlocal.json');
const writeLocal = (dims, ageHours = 0) => writeFileSync(localPath, JSON.stringify({ dims, at: Date.now() - ageHours * 3600000 }));
// 0) 心情来源只剩本地：旧的 integration.moodSource 三档（plugin/auto/local）已移除
ok.push(["配置里没有心情来源字段", !('moodSource' in DEFAULTS.integration), Object.keys(DEFAULTS.integration)]);
ok.push(["面板也没有心情来源下拉", !FIELDS.some((f) => f.k === 'integration.moodSource')]);
// 1) 没有本地数据 → 没有心情（诚实为 null）
rmSync(localPath, { force: true });
ok.push(["两边都没数据 → 没有心情", mood.readMood() === null]);
ok.push(["没有心情 → 不产生语气", mood.moodToneOf(mood.readMood()) === null]);
// 2) 本地有信号 → 用本地
writeLocal({ happy: 5, calm: 3 });
const lm = mood.readMood();
ok.push(["本地有数据 → 用本地", lm && lm.source === 'local' && !lm.stale, lm && lm.source]);
ok.push(["本地分数由七维算出", Math.abs(lm.mood - (50 + 3 * 5 + 1 * 3)) < 0.5, lm.mood]);
// 3) 读心情不再看 cfg（来源固定本地）
const cfg = clone(DEFAULTS);
cfg.integration.linkMood = false;
ok.push(["readMood 不再受配置来源影响", mood.readMood(cfg).source === 'local']);
// 4) 本地引擎：夸→升，怼→降，衰减回落
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
ok.push(["24 小时后向 50 回落", Math.abs(decayed - 50) < Math.abs(s2 - 50) && decayed >= 0 && decayed <= 100, [s2, decayed]]);
// 5) 面板：心情页 + 本地心情卡片
ok.push(["页签里有「心情」", TABS.some(t => t[0] === 'mood'), TABS.map(t=>t[0])]);
const moodFields = FIELDS.filter(f => f.tab === 'mood').map(f => f.k);
ok.push(["心情字段都挂在心情页", moodFields.includes('integration.linkMood') && moodFields.includes('mood.v2Enabled'), moodFields]);
const panel = readFileSync(new URL('../panel.html', import.meta.url), "utf8");
ok.push(["面板有心情卡片渲染", panel.includes('moodCardHtml')]);
ok.push(["面板能重置本地心情", panel.includes('resetLocal')]);
console.log("=== 本地心情来源 / 心情页 测试 ===");
let fail = 0;
for (const [n, pass, extra] of ok) { console.log((pass ? "OK  " : "FAIL ") + n + (pass ? "" : "   " + JSON.stringify(extra))); if (!pass) fail++ }
console.log(fail ? ("失败 " + fail) : "全部通过");
process.exit(fail ? 1 : 0);
