import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
process.env.DSH_HOME = process.env.DSH_HOME || 'C:/dsh-test-temp/dsh-test-home' // __TEST_HOME__ 隔离，绝不写真实配置
const base = new URL('../lib/', import.meta.url).href;
const P = await import(base + "profile.js");
const { loadConfig } = await import(base + "config.js");
const { ensureDirs } = await import(base + "store.js");
ensureDirs();
const cfg = loadConfig();
const ok = [];
const G = "g-test-profile";
P.clearGroup(G);
for (let i = 0; i < 25; i++) P.record(cfg, G, "u-a", "今天加班到好晚啊，想喝冰美式，明天还要上班", i % 5 === 0);
for (let i = 0; i < 8; i++) P.record(cfg, G, "u-b", "嗯嗯", false);
P.record(cfg, G, "u-c", "话说这个项目前端用什么", false);

const before = P.listMembers(G);
ok.push(["记录成员 3 人", before.length === 3]);
ok.push(["发言计数 25", before.some((m) => m.msgs === 25)]);
ok.push(["短消息被忽略", before.find((m) => m.msgs === 8) !== undefined]);

const r = P.induce(G, cfg);
ok.push(["归纳达标 1 人", r.updated === 1]);
const after = P.listMembers(G);
const a = after.find((m) => m.msgs === 25);
ok.push(["有特质", (a.traits || []).length > 0]);
ok.push(["有常用词", (a.topWords || []).length > 0]);
ok.push(["有活跃时段", (a.peakHours || []).length > 0]);
const card = P.speedCard(G, cfg);
ok.push(["速写卡非空", card.includes("本群成员速写")]);
ok.push(["速写卡不含原始 openid", !card.includes("u-a")]);
const st = P.stats(G);
ok.push(["统计正确", st.total === 3 && st.active === 1]);
const bKey = after.find((m) => m.msgs === 8).key;
ok.push(["屏蔽成功", P.deleteMember(G, bKey, true).ok === true]);
P.record(cfg, G, "u-b", "又说了一句", false);
ok.push(["屏蔽后不再计数", P.listMembers(G).find((m) => m.key === bKey).msgs === 0]);
ok.push(["清空", P.clearGroup(G).removed === 3]);

console.log("=== 画像模块测试 ==="); let fail = 0;
for (const [n, p] of ok) { console.log(`${p ? "✅" : "❌"} ${n}`); if (!p) fail++ }
console.log(fail ? `失败 ${fail}` : "全部通过");



// 断言失败要真的算失败（run-all 只看 exit code）
process.exitCode = fail ? 1 : 0;

