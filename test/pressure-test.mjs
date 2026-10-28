process.env.DSH_HOME = 'C:/Users/Ranmi/AppData/Local/Temp/dsh-test-press';
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
const U = await import(base + "lib/usage.js");
const ok = []; const A = (n, c, e) => ok.push([n, !!c, e]);
const mk = (used, win) => ({ record: { rows: { contextPressure: { val: { pressureTokens: used, contextWindow: win } } } } });
A("80k/128k ≈ 0.63", Math.abs(U.pressureRatioOf(mk(80000, 128000)) - 0.625) < 0.01, U.pressureRatioOf(mk(80000, 128000)));
A("接近用满 → 1", U.pressureRatioOf(mk(200000, 128000)) === 1);
A("没有数据 → 0", U.pressureRatioOf({}) === 0);
A("窗口为 0 不会 NaN", U.pressureRatioOf(mk(100, 0)) === 0);
console.log("=== 上下文压力 测试 ===");
let fail = 0;
for (const [n, pass, e] of ok) { console.log((pass ? "OK  " : "FAIL ") + n + (pass ? "" : "   " + JSON.stringify(e || {}).slice(0, 120))); if (!pass) fail++; }
console.log(fail ? ("失败 " + fail) : ("全部通过 " + ok.length + "/" + ok.length));
await new Promise((r) => setTimeout(r, 150));
process.exitCode = fail ? 1 : 0;
