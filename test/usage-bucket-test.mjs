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
const bj = (h, m, d = 27) => Date.UTC(2026, 9, d, h - 8, m, 0);
T("周二 10:00 是高峰", U.bucketNow(cfg, bj(10, 0, 27)) === "peak", U.bucketNow(cfg, bj(10, 0, 27)));
T("周三 03:00 是空闲", U.bucketNow(cfg, bj(3, 0, 28)) === "offpeak", U.bucketNow(cfg, bj(3, 0, 28)));
T("08:40 不在高峰窗口", U.bucketNow(cfg, bj(8, 40, 27)) === "offpeak", U.bucketNow(cfg, bj(8, 40, 27)));
T("周六 10:00 全程空闲", U.bucketNow(cfg, bj(10, 0, 31)) === "offpeak", U.bucketNow(cfg, bj(10, 0, 31)));
T("周二 16:00 是高峰", U.bucketNow(cfg, bj(16, 0, 27)) === "peak", U.bucketNow(cfg, bj(16, 0, 27)));
T("12:30 午休按空闲", U.bucketNow(cfg, bj(12, 30, 27)) === "offpeak", U.bucketNow(cfg, bj(12, 30, 27)));
// 计价：峰 100% / 谷 50% / 搜索按次
cfg.usage.calibFactor = 1; cfg.usage.priceOffPeakFactor = 0.5; cfg.usage.priceSearch = 0.01;
const db = { date: '2026-10-27', buckets: { peak: { input: 1e6, output: 0, hit: 0 }, offpeak: { input: 1e6, output: 0, hit: 0 } }, last: {}, search: 3 };
writeFileSync(HOME + '/storages/dsh-qqbot-refine/usage-buckets.json', JSON.stringify(db));
const r = U.bucketsReport(cfg);
T("高峰 100 万未命中 = ¥2", r.peakCost === 2, r);
T("空闲 100 万未命中（半价）= ¥1", r.offpeakCost === 1, r);
T("搜索在 11-01 前免费", r.searchCost === 0, r);
T("合计 = ¥3（搜索未计费）", r.total === 3, r.total);
// 校准系数对峰谷都生效
cfg.usage.calibFactor = 0.5;
const r2 = U.bucketsReport(cfg);
T("校准 ×0.5 后 = ¥1.5", Math.abs(r2.total - 1.5) < 0.005, r2.total);
console.log("=== 峰谷/搜索计价 测试 ===");
let fail = 0;
for (const [n, pass, e] of ok) { console.log((pass ? "OK  " : "FAIL ") + n + (pass ? "" : "   " + JSON.stringify(e || {}).slice(0, 160))); if (!pass) fail++; }
console.log(fail ? ("失败 " + fail) : ("全部通过 " + ok.length + "/" + ok.length));
await new Promise((r) => setTimeout(r, 150));
process.exitCode = fail ? 1 : 0;
