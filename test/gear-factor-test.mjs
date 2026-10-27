process.env.DSH_HOME = 'C:/Users/Ranmi/AppData/Local/Temp/dsh-test-gear';
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
const HOME = process.env.DSH_HOME;
try { rmSync(HOME, { recursive: true, force: true }) } catch {}
mkdirSync(HOME + "/profiles/desktop", { recursive: true });
writeFileSync(HOME + "/profiles/desktop/cordis.patch.yml", "- id: im-qqbot\n  config:\n    appId: '1905982004'\n    appSecret: dummy\n", "utf8");
const { pathToFileURL } = await import("node:url");
const { homedir } = await import("node:os");
const { join } = await import("node:path");
const base = pathToFileURL(join(homedir(), '.dsh', 'profiles', 'desktop', 'node_modules', 'dsh-qqbot-refine')).href + '/';
const { ensureDirs } = await import(base + "lib/store.js");
ensureDirs();
const C = await import(base + "lib/config.js");
const ok = []; const A = (n, c, e) => ok.push([n, !!c, e]);
A("3 挡是基准（×1）", C.gearFactor(3) === 1);
A("1 挡最安静（×0.3）", C.gearFactor(1) === 0.3);
A("5 挡最活跃（×2.4）", C.gearFactor(5) === 2.4);
A("越活跃概率越高", C.gearFactor(1) < C.gearFactor(3) && C.gearFactor(3) < C.gearFactor(5));
A("挡位高了冷却变短", C.gearCooldownFactor(5) < C.gearCooldownFactor(3) && C.gearCooldownFactor(1) > C.gearCooldownFactor(3));
A("滑条字段（range）", (() => { const f = Array.from(C.FIELD_MAP.values()).find((x) => x.k === "frequency.chatGear"); return f && f.t === "range" && f.min === 1 && f.max === 5 })());
A("异常值不会崩", C.gearFactor(99) === 2.4 && C.gearFactor("x") === 1);
console.log("=== 接话挡位 测试 ===");
let fail = 0;
for (const [n, pass, e] of ok) { console.log((pass ? "OK  " : "FAIL ") + n + (pass ? "" : "   " + JSON.stringify(e || {}).slice(0, 120))); if (!pass) fail++; }
console.log(fail ? ("失败 " + fail) : ("全部通过 " + ok.length + "/" + ok.length));
await new Promise((r) => setTimeout(r, 150));
process.exitCode = fail ? 1 : 0;
