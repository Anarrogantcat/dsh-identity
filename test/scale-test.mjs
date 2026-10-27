import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
process.env.DSH_HOME = 'C:/Users/Ranmi/AppData/Local/Temp/dsh-test-scale';
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
const HOME = process.env.DSH_HOME;
try { rmSync(HOME, { recursive: true, force: true }) } catch {}
mkdirSync(HOME + "/profiles/desktop", { recursive: true });
writeFileSync(HOME + "/profiles/desktop/cordis.patch.yml", "- id: im-qqbot\n  config:\n    appId: '1905982004'\n    appSecret: dummy\n", "utf8");
const base = pathToFileURL(join(homedir(), '.dsh', 'profiles', 'desktop', 'node_modules', 'dsh-qqbot-refine')).href + '/';
const P = await import(base + "lib/persona.js");
const { DEFAULTS, FIELD_MAP } = await import(base + "lib/config.js");
const ok = []; const T = (n, c, e) => ok.push([n, !!c, e]);
T("默认尺度 50", DEFAULTS.persona.scale === 50, DEFAULTS.persona.scale);
const f = FIELD_MAP.get("persona.scale");
T("字段是 range，0-100", f && f.t === "range" && f.min === 0 && f.max === 100, f);
T("0-25 → 保守", P.scaleBlock(10).includes("保守"), P.scaleBlock(10));
T("26-50 → 日常", P.scaleBlock(50).includes("日常"), P.scaleBlock(50));
T("51-75 → 放松", P.scaleBlock(70).includes("放松") && P.scaleBlock(75).includes("放松"), P.scaleBlock(75));
T("76+ → 放飞", P.scaleBlock(90).includes("放飞"), P.scaleBlock(90));
T("越界被夹住（-5 保守 / 200 放飞）", P.scaleBlock(-5).includes("保守") && P.scaleBlock(200).includes("放飞"));
T("带当前数值", P.scaleBlock(60).includes("60/100"), P.scaleBlock(60));
T("底线不随尺度变", P.scaleBlock(100).includes("底线"), P.scaleBlock(100));
console.log("=== 聊天尺度 测试 ===");
let fail = 0;
for (const [n, pass, e] of ok) { console.log((pass ? "OK  " : "FAIL ") + n + (pass ? "" : "   " + JSON.stringify(e))); if (!pass) fail++; }
console.log(fail ? ("失败 " + fail + "/" + ok.length) : ("全部通过 " + ok.length + "/" + ok.length));
process.exit(fail ? 1 : 0);
