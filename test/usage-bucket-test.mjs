process.env.DSH_HOME = 'C:/Users/Ranmi/AppData/Local/Temp/dsh-test-bucket';
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
const HOME = process.env.DSH_HOME;
try { rmSync(HOME, { recursive: true, force: true }) } catch {}
mkdirSync(HOME + "/profiles/desktop", { recursive: true });
writeFileSync(HOME + "/profiles/desktop/cordis.patch.yml", "- id: im-qqbot\n  config:\n    appId: '1905982004'\n    appSecret: dummy\n", "utf8");
const base = "file:///C:/Users/Ranmi/.dsh/profiles/desktop/node_modules/dsh-qqbot-refine/";
const { ensureDirs } = await import(base + "lib/store.js");
ensureDirs();
const U = await import(base + "lib/usage.js");
const { clone, DEFAULTS } = await import(base + "lib/config.js");
const ok = []; const T = (n, c, e) => ok.push([n, !!c, e]);
const cfg = clone(DEFAULTS);
// 北京时间 10:00 → 峰；03:00 → 谷
const bj = (h, m) => Date.UTC(2026, 9, 27, h - 8, m, 0);
T("10:00 是峰时", U.bucketNow(cfg, bj(10, 0)) === "peak", U.bucketNow(cfg, bj(10, 0)));
T("03:00 是谷时", U.bucketNow(cfg, bj(3, 0)) === "offpeak", U.bucketNow(cfg, bj(3, 0)));
T("08:40 是峰时", U.bucketNow(cfg, bj(8, 40)) === "peak", U.bucketNow(cfg, bj(8, 40)));
T("00:10 是峰时（峰时段延续到 00:30）", U.bucketNow(cfg, bj(0, 10)) === "peak", U.bucketNow(cfg, bj(0, 10)));
T("04:00 是谷时", U.bucketNow(cfg, bj(4, 0)) === "offpeak", U.bucketNow(cfg, bj(4, 0)));
// 计价：峰 100% / 谷 50% / 搜索按次
cfg.usage.calibFactor = 1; cfg.usage.priceOffPeakFactor = 0.5; cfg.usage.priceSearch = 0.01;
const db = { date: '2026-10-27', buckets: { peak: { input: 1e6, output: 0, hit: 0 }, offpeak: { input: 1e6, output: 0, hit: 0 } }, last: {}, search: 3 };
writeFileSync(HOME + '/storages/dsh-qqbot-refine/usage-buckets.json', JSON.stringify(db));
const r = U.bucketsReport(cfg);
T("峰 100 万输入 = ¥2", r.peakCost === 2, r);
T("谷 100 万输入打五折 = ¥1", r.offpeakCost === 1, r);
T("3 次搜索 = ¥0.03", r.searchCost === 0.03, r);
T("合计 = ¥3.03", r.total === 3.03, r.total);
// 校准系数对峰谷都生效
cfg.usage.calibFactor = 0.5;
const r2 = U.bucketsReport(cfg);
T("校准 ×0.5 后：峰谷减半、搜索原价（1 + 0.25×2 + 0.03 = 1.53）", Math.abs(r2.total - 1.53) < 0.005, r2.total);
console.log("=== 峰谷/搜索计价 测试 ===");
let fail = 0;
for (const [n, pass, e] of ok) { console.log((pass ? "OK  " : "FAIL ") + n + (pass ? "" : "   " + JSON.stringify(e || {}).slice(0, 160))); if (!pass) fail++; }
console.log(fail ? ("失败 " + fail) : ("全部通过 " + ok.length + "/" + ok.length));
await new Promise((r) => setTimeout(r, 150));
process.exitCode = fail ? 1 : 0;
