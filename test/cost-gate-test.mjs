import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
process.env.DSH_HOME = 'C:/Users/Ranmi/AppData/Local/Temp/dsh-test-cost';
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
const HOME = process.env.DSH_HOME;
try { rmSync(HOME, { recursive: true, force: true }) } catch {}
mkdirSync(HOME + "/profiles/desktop", { recursive: true });
writeFileSync(HOME + "/profiles/desktop/cordis.patch.yml", "- id: im-qqbot\n  config:\n    appId: '1905982004'\n    appSecret: dummy-secret-for-test\n", "utf8");
const base = pathToFileURL(join(homedir(), '.dsh', 'profiles', 'desktop', 'node_modules', 'dsh-qqbot-refine')).href + '/';
const C = await import(base + "lib/cost.js");
const U = await import(base + "lib/usage.js");
const { loadConfig, saveConfig, clone, DEFAULTS } = await import(base + "lib/config.js");
const { ensureDirs } = await import(base + "lib/store.js");
ensureDirs();
const ok = [];
const A = (n, c, e) => ok.push([n, !!c, e]);
// 造一个今天的会话快照，让花费可算
import { createHash } from "node:crypto";
const sid = U.sidFor("1905982004", "group", "G1");
const sessDir = HOME + "/storages/session_projcache/sessions";
mkdirSync(sessDir, { recursive: true });
const writeTotals = (input, output, hit) => writeFileSync(sessDir + "/" + sid + ".json", JSON.stringify({ record: { rows: { tokenUsage: { val: { totals: { uncachedInputTokens: input, outputTokens: output, cacheReadTokens: hit, cacheWriteTokens: 0 } } } } } }));
const cfg = clone(DEFAULTS);
cfg.scope.groups = ["G1"];
cfg.usage.hardLimitEnabled = false; cfg.usage.dailyYuanHardLimit = 0.01;
saveConfig(cfg);
writeTotals(0, 0, 0); U.resetToday(); U.usageReport(loadConfig()); writeTotals(100000, 100000, 0);
// 1) 开关关闭：不拦
const off = C.gateDecision(loadConfig());
A("开关关 → 不拦", off.block === false && off.state === "off", off);
// 2) 打开 + 超限 + degrade
const c2 = loadConfig(); c2.usage.hardLimitEnabled = true; c2.usage.onExceed = "degrade"; saveConfig(c2);
const d1 = C.gateDecision(loadConfig());
A("超限 → 拦（degrade）", d1.block === true && d1.state === "exceed" && d1.action === "degrade", d1);
A("degrade 会回一句模板", d1.speak === true && /超/.test(d1.text), d1.text);
const d2 = C.gateDecision(loadConfig());
A("30 分钟内不重复刷模板", d2.block === true && d2.speak === false, d2);
// 3) mute 模式
C.resetCostGuard();
const c3 = loadConfig(); c3.usage.onExceed = "mute"; saveConfig(c3);
const m1 = C.gateDecision(loadConfig());
A("超限 → 静默（mute）", m1.block === true && m1.speak === false && m1.action === "mute", m1);
// 4) 阈值提醒只一次
C.resetCostGuard();
const c4 = loadConfig(); c4.usage.onExceed = "degrade"; c4.usage.dailyYuanHardLimit = 1; c4.usage.warnAt = 0.01; saveConfig(c4);
writeTotals(0, 0, 0); U.resetToday(); U.usageReport(loadConfig()); writeTotals(200000, 0, 0);  // 约 ¥0.4
const w1 = C.gateDecision(loadConfig());
A("接近阈值 → 提醒一次且不拦", w1.block === false && w1.state === "warn" && w1.notifyOwner === true, w1);
const w2 = C.gateDecision(loadConfig());
A("提醒只发一次", w2.notifyOwner !== true, w2);
// 5) 读不到用量 → 不拦
// 把凭证文件挪走 → 读不到 appId → 用量未知
const { renameSync } = await import("node:fs");
renameSync(HOME + "/profiles/desktop/cordis.patch.yml", HOME + "/profiles/desktop/cordis.patch.yml.off");
const unk = C.gateDecision(loadConfig());
renameSync(HOME + "/profiles/desktop/cordis.patch.yml.off", HOME + "/profiles/desktop/cordis.patch.yml");
A("读不到用量 → 不拦（unknown）", unk.block === false && unk.state === "unknown", unk);
console.log("=== 花费硬闸 测试 ===");
let fail = 0;
for (const [n, pass, e] of ok) { console.log((pass ? "OK  " : "FAIL ") + n + (pass ? "" : "   " + JSON.stringify(e))); if (!pass) fail++ }
console.log(fail ? ("失败 " + fail) : "全部通过");
process.exit(fail ? 1 : 0);
