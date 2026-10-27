import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
process.env.DSH_HOME = 'C:/Users/Ranmi/AppData/Local/Temp/dsh-test-draft';
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
const HOME = process.env.DSH_HOME;
try { rmSync(HOME, { recursive: true, force: true }) } catch {}
mkdirSync(HOME + "/profiles/desktop", { recursive: true });
writeFileSync(HOME + "/profiles/desktop/cordis.patch.yml", "- id: im-qqbot\n  config:\n    appId: '1905982004'\n    appSecret: dummy\n", "utf8");
const base = pathToFileURL(join(homedir(), '.dsh', 'profiles', 'desktop', 'node_modules', 'dsh-qqbot-refine')).href + '/';
const { ensureDirs } = await import(base + "lib/store.js");
ensureDirs();
const D = await import(base + "lib/draw.js");
const ok = []; const T = (n, c, e) => ok.push([n, !!c, e]);
const withRef = D.draftMessage({ userText: '根据这个画', width: 512, height: 768, steps: 22, ttl: 90, ref: true, refUrl: 'http://x/y.png' }, []);
T("有参考图：文案说图生图", withRef.includes("参考") && withRef.includes("图生图"), withRef);
T("有参考图：不出现搜索摘要", !/参考：http/.test(withRef) && !withRef.includes("512×768"), withRef);
const noRef = D.draftMessage({ userText: '大肥鱼', width: 512, height: 768, steps: 22, ttl: 90 }, ['某视频 播放量 6 万']);
T("没参考图：才给搜索摘要", noRef.includes("参考：某视频"), noRef);
T("重绘强度默认 0.6", (await import(base + "lib/config.js")).DEFAULTS.draw.refDenoise === 0.6);
console.log("=== 参考图流程 测试 ===");
let fail = 0;
for (const [n, pass, e] of ok) { console.log((pass ? "OK  " : "FAIL ") + n + (pass ? "" : "   " + JSON.stringify(e || {}).slice(0, 160))); if (!pass) fail++; }
console.log(fail ? ("失败 " + fail) : ("全部通过 " + ok.length + "/" + ok.length));
await new Promise((r) => setTimeout(r, 150));
process.exitCode = fail ? 1 : 0;
