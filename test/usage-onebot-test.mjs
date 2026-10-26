process.env.DSH_HOME = 'C:/Users/Ranmi/AppData/Local/Temp/dsh-test-usage-onebot';

import { mkdirSync, writeFileSync, rmSync } from "node:fs";
delete process.env.QQBOT_APPID;
delete process.env.QQBOT_SECRET;
const HOME = process.env.DSH_HOME;
try { rmSync(HOME, { recursive: true, force: true }) } catch {}
mkdirSync(HOME + "/profiles/desktop", { recursive: true });

const base = "file:///C:/Users/Ranmi/.dsh/profiles/desktop/node_modules/dsh-qqbot-refine/";
const U = await import(base + "lib/usage.js");
const OB = await import(base + "lib/onebot-channel.js");
const { ensureDirs } = await import(base + "lib/store.js");
const { loadConfig, saveConfig, clone, DEFAULTS } = await import(base + "lib/config.js");
ensureDirs();

const ok = [];
const add = (name, pass, extra) => ok.push([name, pass, extra]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// ── sidForOneBot 与 onebot-channel.sessionIdFor 必须逐字节一致 ──
const cases = [["group", "690618714"], ["c2c", "10086"], ["group", "123456789"], ["c2c", "abcdef"]];
add("group 会话 id 与 onebot-channel 一致", U.sidForOneBot("group", "690618714") === OB.sessionIdFor("group", "690618714"),
  { mine: U.sidForOneBot("group", "690618714"), theirs: OB.sessionIdFor("group", "690618714") });
add("c2c 会话 id 与 onebot-channel 一致", U.sidForOneBot("c2c", "10086") === OB.sessionIdFor("c2c", "10086"),
  { mine: U.sidForOneBot("c2c", "10086"), theirs: OB.sessionIdFor("c2c", "10086") });
add("四组样本全部一致（含长数字/字母）", cases.every(([s, p]) => U.sidForOneBot(s, p) === OB.sessionIdFor(s, p)));
add("形状是 uuid", cases.every(([s, p]) => UUID.test(U.sidForOneBot(s, p))));
add("命名空间独立：和 tencent 的 sidFor 不同", U.sidForOneBot("group", "690618714") !== U.sidFor("1905982004", "group", "690618714"));

// ── 没有快照也不能崩 ──
const onebotCfg = clone(DEFAULTS);
onebotCfg.transport.mode = "onebot";
onebotCfg.scope.groups = ["690618714", "987654321"];
onebotCfg.scope.dmUsers = ["10086"];
let empty = null;
try { empty = U.usageReport(onebotCfg); } catch (e) { empty = { crash: String(e?.message ?? e) }; }
add("无快照时 usageReport 不崩、ok=true", empty?.ok === true, empty);
add("无快照时 rows 为空、合计为 0", Array.isArray(empty?.rows) && empty.rows.length === 0 && empty.totals.total === 0 && empty.all.total === 0, empty?.totals);
add("onebot 分支 mode === 'onebot'", empty?.mode === "onebot", empty?.mode);
add("返回结构和 tencent 一致（prices/rows/totals/all）",
  !!empty && empty.prices && Array.isArray(empty.rows) && empty.totals && empty.all && typeof empty.totals.yuan === "number", Object.keys(empty ?? {}));

// ── 有快照：群 + 私聊都能汇总 ──
const sessDir = HOME + "/storages/session_projcache/sessions";
mkdirSync(sessDir, { recursive: true });
const sidG = U.sidForOneBot("group", "690618714");
const sidD = U.sidForOneBot("c2c", "10086");
const snap = (uncached, out, hit) => JSON.stringify({ record: { rows: { tokenUsage: { val: { totals: { uncachedInputTokens: uncached, outputTokens: out, cacheReadTokens: hit, cacheWriteTokens: 0 } } } } } });
writeFileSync(sessDir + "/" + sidG + ".json", snap(1000, 200, 3000));
writeFileSync(sessDir + "/" + sidD + ".json", snap(500, 100, 0));
const first = U.usageReport(onebotCfg);
add("第一次读：今日从 0 起算（记基线）", first.ok === true && first.totals.total === 0 && first.rows.length === 2, first.totals);
add("累计 all 立刻可见", first.all.total === 4800, first.all);
add("rows 里有 group 和 c2c 两行", first.rows.some((r) => r.scope === "group" && r.peer === "690618714" && r.sid === sidG) && first.rows.some((r) => r.scope === "c2c" && r.peer === "10086" && r.sid === sidD), first.rows);
writeFileSync(sessDir + "/" + sidG + ".json", snap(21000, 5200, 53000));
const second = U.usageReport(onebotCfg);
add("今日增量算得对（群：入 20000 出 5000 命中 50000）",
  second.totals.input === 20000 && second.totals.output === 5000 && second.totals.hit === 50000 && second.totals.total === 75000, second.totals);
add("金额 = 0.065 元", second.totals.yuan === 0.065, second.totals.yuan);
add("usageReportOneBot 结构与 usageReport 同形（mode 除外）", (() => {
  const a = U.usageReportOneBot(onebotCfg);
  const b = U.usageReport({ ...onebotCfg, transport: { ...onebotCfg.transport, mode: "onebot" } });
  return JSON.stringify(a) === JSON.stringify(b);
})(), {});

// ── tencent 分支 ──
const tencentCfg = clone(DEFAULTS);
tencentCfg.transport.mode = "tencent";
tencentCfg.scope.groups = ["690618714"];
let noCred = null;
try { noCred = U.usageReport(tencentCfg); } catch (e) { noCred = { crash: String(e?.message ?? e) }; }
add("tencent 没有 appId → ok=false 且报错清楚", noCred?.ok === false && /appId/.test(String(noCred?.error)) && noCred?.mode === "tencent", noCred);
writeFileSync(HOME + "/profiles/desktop/cordis.patch.yml",
  "- id: im-qqbot\n  config:\n    appId: '1905982004'\n    appSecret: dummy-secret-for-test\n", "utf8");
const sidT = U.sidFor("1905982004", "group", "690618714");
writeFileSync(sessDir + "/" + sidT + ".json", snap(1000, 200, 3000));
const tencent = U.usageReport(tencentCfg);
add("tencent 有 appId → mode='tencent'", tencent?.ok === true && tencent.mode === "tencent", tencent?.mode);
add("tencent 用 appId 命名空间（和 onebot 的群 sid 不同）", tencent.rows.length === 1 && tencent.rows[0].sid === sidT && tencent.rows[0].sid !== sidG, tencent.rows);

// ── 今天基线语义不变 ──
U.resetToday();
const afterReset = U.usageReport(onebotCfg);
add("resetToday 后今日归零、累计不丢", afterReset.totals.total === 0 && afterReset.all.total === 79200 + 600, afterReset.all);
add("重置后仍标记 mode='onebot'", afterReset.mode === "onebot");
add("设置写盘能被 loadConfig 读回（不污染真实配置）", (() => {
  const c = clone(DEFAULTS); c.transport.mode = "onebot"; saveConfig(c);
  return loadConfig().transport.mode === "onebot";
})());

console.log("=== OneBot 用量 / 会话 id 测试 ===");
let fail = 0;
for (const [n, pass, extra] of ok) { console.log((pass ? "OK  " : "FAIL ") + n + (pass ? "" : "   " + JSON.stringify(extra))); if (!pass) fail++ }
console.log(fail ? ("失败 " + fail) : ("全部通过 " + (ok.length - fail) + "/" + ok.length));
process.exit(fail ? 1 : 0);
