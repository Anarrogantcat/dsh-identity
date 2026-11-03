import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
process.env.DSH_HOME = process.env.TEMP.replace(/\\/g, '/') + '/dsh-test-bucket';
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
const HOME = process.env.DSH_HOME;
try { rmSync(HOME, { recursive: true, force: true }) } catch {}
mkdirSync(HOME + "/profiles/desktop", { recursive: true });
writeFileSync(HOME + "/profiles/desktop/cordis.patch.yml", "- id: im-qqbot\n  config:\n    appId: '1905982004'\n    appSecret: dummy\n", "utf8");
const base = new URL('../', import.meta.url).href;
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
const _d = new Date(); const _p = (n) => String(n).padStart(2, '0');
const todayLocal = `${_d.getFullYear()}-${_p(_d.getMonth() + 1)}-${_p(_d.getDate())}`;
const db = { date: todayLocal, buckets: { peak: { input: 1e6, output: 0, hit: 0 }, offpeak: { input: 1e6, output: 0, hit: 0 } }, last: {}, search: 3 };
writeFileSync(HOME + '/storages/dsh-qqbot-refine/usage-buckets.json', JSON.stringify(db));
const r = U.bucketsReport(cfg);
T("高峰 100 万未命中 = ¥2", r.peakCost === 2, r);
T("空闲 100 万未命中（半价）= ¥1", r.offpeakCost === 1, r);
// 搜索免费期：默认截止 2026-11-01T00:00+08，之后按次计费。
// 以前这里直接拿「今天」去比默认截止日，写测试那天（10 月底）还免费，11-02 之后就必然红——
// 是测试过期，不是代码变了。改成显式给两侧的截止日，两个方向都验。
cfg.usage.searchFreeUntil = '2099-01-01T00:00:00+08:00';
const rFree = U.bucketsReport(cfg);
T("免费期内搜索不计费", rFree.searchCost === 0, rFree);
T("免费期内合计 = ¥3", rFree.total === 3, rFree.total);
cfg.usage.searchFreeUntil = '2020-01-01T00:00:00+08:00';
const rPaid = U.bucketsReport(cfg);
T("免费期过后按次计费（3 次 × 0.01 = ¥0.03）", Math.abs(rPaid.searchCost - 0.03) < 0.0005, rPaid.searchCost);
T("免费期过后合计 = ¥3.03", Math.abs(rPaid.total - 3.03) < 0.0005, rPaid.total);
// 校准系数对峰谷都生效（回到免费期，排除搜索项干扰）
cfg.usage.searchFreeUntil = '2099-01-01T00:00:00+08:00';
cfg.usage.calibFactor = 0.5;
const r2 = U.bucketsReport(cfg);
T("校准 ×0.5 后 = ¥1.5", Math.abs(r2.total - 1.5) < 0.005, r2.total);
console.log("=== 峰谷/搜索计价 测试 ===");
let fail = 0;
for (const [n, pass, e] of ok) { console.log((pass ? "OK  " : "FAIL ") + n + (pass ? "" : "   " + JSON.stringify(e || {}).slice(0, 160))); if (!pass) fail++; }
console.log(fail ? ("失败 " + fail) : ("全部通过 " + ok.length + "/" + ok.length));
await new Promise((r) => setTimeout(r, 150));
process.exitCode = fail ? 1 : 0;
