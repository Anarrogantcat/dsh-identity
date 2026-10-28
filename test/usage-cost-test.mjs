import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
process.env.DSH_HOME = 'C:/Users/Ranmi/AppData/Local/Temp/dsh-test-usage';
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
const HOME = process.env.DSH_HOME;
try { rmSync(HOME, { recursive: true, force: true }) } catch {}
mkdirSync(HOME + "/profiles/desktop", { recursive: true });
writeFileSync(HOME + "/profiles/desktop/cordis.patch.yml", "- id: im-qqbot\n  config:\n    appId: '1905982004'\n    appSecret: dummy-secret-for-test\n", "utf8");
const base = new URL('../', import.meta.url).href;
const U = await import(base + "lib/usage.js");
const { ensureDirs } = await import(base + "lib/store.js");
const { loadConfig, saveConfig, clone, DEFAULTS } = await import(base + "lib/config.js");
ensureDirs();
const ok = [];
// ── 单价折算 ──
const t = { uncachedInputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 0 };
const _dp = U.DEFAULT_PRICES;
const _defExp = (1 * _dp.inputMiss + 1 * _dp.inputHit + 1 * _dp.output) * (_dp.calibFactor ?? 1);
ok.push(["默认价 1M 全覆盖（按官方价×校准）", Math.abs(U.costOf(t) - _defExp) < 1e-9, { got: U.costOf(t), exp: _defExp, prices: _dp }]);
ok.push(["自定义价生效（校准=1）", U.costOf(t, { inputMiss: 1, inputHit: 0, output: 0, calibFactor: 1 }) === 1, U.costOf(t, { inputMiss: 1, inputHit: 0, output: 0, calibFactor: 1 })]);
ok.push(["空用量 = 0", U.costOf({}) === 0]);
ok.push(["tokens 汇总含 cacheWrite", (() => { const x = U.tokensOf({ uncachedInputTokens: 10, cacheWriteTokens: 5, outputTokens: 7, cacheReadTokens: 3 }); return x.input === 15 && x.total === 25; })()]);
// ── 会话快照 → 今日增量 ──
const appId = '1905982004';
const sid = U.sidFor(appId, 'group', '6EC25148B7DCD81CDB999EF9D6811D5A');
ok.push(["会话 id 与 dsh-qqbot 一致", sid === '28dba43e-31be-e2b3-4786-de049c2c6878', sid]);
const sessDir = HOME + "/storages/session_projcache/sessions";
mkdirSync(sessDir, { recursive: true });
writeFileSync(sessDir + "/" + sid + ".json", JSON.stringify({ record: { rows: { tokenUsage: { val: { totals: { uncachedInputTokens: 1000, outputTokens: 200, cacheReadTokens: 3000, cacheWriteTokens: 0 } } } } } }));
const cfg = clone(DEFAULTS);
cfg.scope.groups = ['6EC25148B7DCD81CDB999EF9D6811D5A'];
saveConfig(cfg);
const first = U.usageReport(loadConfig());
ok.push(["第一天从 0 起算", first.ok && first.totals.total === 0, first.totals]);
// 用量增长后再看
writeFileSync(sessDir + "/" + sid + ".json", JSON.stringify({ record: { rows: { tokenUsage: { val: { totals: { uncachedInputTokens: 21000, outputTokens: 5200, cacheReadTokens: 53000, cacheWriteTokens: 0 } } } } } }));
const second = U.usageReport(loadConfig());
ok.push(["增量算得对（入 20000 出 5000 命中 50000）", second.totals.input === 20000 && second.totals.output === 5000 && second.totals.hit === 50000, second.totals]);
const _p2 = U.pricesOf({ usage: {} });
const _exp2 = Number(U.costOf({ uncachedInputTokens: 20000, outputTokens: 5000, cacheReadTokens: 50000, cacheWriteTokens: 0 }, _p2).toFixed(4));
ok.push(["金额按当前价与校准算", Math.abs(U.costOf({ uncachedInputTokens: 20000, outputTokens: 5000, cacheReadTokens: 50000, cacheWriteTokens: 0 }, _p2) - _exp2) < 1e-9, _exp2]);
// 预算比 ──
const _cur = Number(U.usageReport(loadConfig()).totals.yuan || 0.01);
const cfg2 = loadConfig(); cfg2.usage.groupDailyYuan = Math.max(0.0001, _cur / 2); saveConfig(cfg2);
const over = U.usageReport(loadConfig());
ok.push(["超预算能被看出来", Number(over.totals.yuan) > Number(cfg2.usage.groupDailyYuan), { yuan: over.totals.yuan, limit: cfg2.usage.groupDailyYuan }]);
// ── 面板行 ──
const mgmt = await import(base + "lib/mgmt.js");
const table = mgmt.list('usage');
const labels = table.rows.map(r => r.k);
ok.push(["面板显示今日花费（元）", labels.includes('今日花费（估算）'), labels.slice(0, 6)]);
ok.push(["面板显示今日 tokens", labels.includes('今日 tokens')]);
ok.push(["面板显示高峰单价", labels.includes('高峰单价（元/百万）')]);
ok.push(["面板显示空闲单价", labels.includes('空闲单价（元/百万）')]);
ok.push(["面板显示每群明细", labels.some(k => k.includes('群 6EC25148'))]);
ok.push(["金额带 ¥ 符号", table.rows.some(r => String(r.v).includes('¥'))]);
// 重置基线
U.resetToday();
const afterReset = U.usageReport(loadConfig());
ok.push(["重置后今日归零", afterReset.totals.total === 0, afterReset.totals]);
console.log("=== 真实用量 / 金额 测试 ===");
let fail = 0;
for (const [n, pass, extra] of ok) { console.log((pass ? "OK  " : "FAIL ") + n + (pass ? "" : "   " + JSON.stringify(extra))); if (!pass) fail++ }
console.log(fail ? ("失败 " + fail) : "全部通过");
process.exit(fail ? 1 : 0);
