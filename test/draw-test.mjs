import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
process.env.DSH_HOME = 'C:/Users/Ranmi/AppData/Local/Temp/dsh-test-draw';
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
const HOME = process.env.DSH_HOME;
try { rmSync(HOME, { recursive: true, force: true }) } catch {}
mkdirSync(HOME + "/profiles/desktop", { recursive: true });
writeFileSync(HOME + "/profiles/desktop/cordis.patch.yml", "- id: im-qqbot\n  config:\n    appId: '1905982004'\n    appSecret: dummy\n", "utf8");
const base = pathToFileURL(join(homedir(), '.dsh', 'profiles', 'desktop', 'node_modules', 'dsh-qqbot-refine')).href + '/';
const { ensureDirs } = await import(base + "lib/store.js");
ensureDirs();
const D = await import(base + "lib/draw.js");
const { DEFAULTS, FIELD_MAP, TABS, clone } = await import(base + "lib/config.js");
const ok = []; const T = (n, c, e) => ok.push([n, !!c, e]);
const p1 = D.buildDrawPrompt('坐在云上吃白饭');
T("提示词带角色基准", p1.includes("chibi") && p1.includes("whale tail") && p1.includes("坐在云上吃白饭"), p1.slice(0, 120));
T("空输入也只给基准", D.buildDrawPrompt("") === D.BASE_PROMPT);
T("负面词覆盖常见崩坏", /worst quality/.test(D.BASE_NEGATIVE) && /extra limbs/.test(D.BASE_NEGATIVE), D.BASE_NEGATIVE.slice(0, 60));
T("默认尺寸 512x768", DEFAULTS.draw.width === 512 && DEFAULTS.draw.height === 768, DEFAULTS.draw);
T("群友默认可用、额度 3/2", DEFAULTS.draw.members === true && DEFAULTS.draw.perGroupHour === 3 && DEFAULTS.draw.perUserDay === 2, DEFAULTS.draw);
T("生图页签存在", TABS.some((t) => t[0] === "draw"), TABS.map((t) => t[0]).join(","));
T("字段都在 draw 页", ["draw.enabled","draw.members","draw.width","draw.height","draw.steps"].every((k) => (FIELD_MAP.get(k) || {}).tab === "draw"));
T("有停止语音的入口", typeof D.stopVoice === "function");
console.log("=== 生图 测试 ===");
let fail = 0;
for (const [n, pass, e] of ok) { console.log((pass ? "OK  " : "FAIL ") + n + (pass ? "" : "   " + JSON.stringify(e || {}).slice(0, 160))); if (!pass) fail++; }
console.log(fail ? ("失败 " + fail) : ("全部通过 " + ok.length + "/" + ok.length));
process.exit(fail ? 1 : 0);
