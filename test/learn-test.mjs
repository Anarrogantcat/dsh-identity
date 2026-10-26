process.env.DSH_HOME = 'C:/Users/Ranmi/AppData/Local/Temp/dsh-test-learn';
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
const HOME = process.env.DSH_HOME;
try { rmSync(HOME, { recursive: true, force: true }) } catch {}
mkdirSync(HOME + "/profiles/desktop", { recursive: true });
writeFileSync(HOME + "/profiles/desktop/cordis.patch.yml", "- id: im-qqbot\n  config:\n    appId: '1905982004'\n    appSecret: dummy-secret-for-test\n", "utf8");
const base = "file:///C:/Users/Ranmi/.dsh/profiles/desktop/node_modules/dsh-qqbot-refine/";
const learn = await import(base + "lib/learn.js");
const { ensureDirs, peerKey } = await import(base + "lib/store.js");
ensureDirs();
const ok = [];
const eq = (n, got, want) => ok.push([n, JSON.stringify(got) === JSON.stringify(want), got, want]);
// ── 抽规矩 ──
eq("不要 X", learn.extractRule("以后不要用敬语"), "不要用敬语");
eq("别 X", learn.extractRule("别老是叫我大佬"), "不要叫我大佬");
eq("记住 X", learn.extractRule("记住：这个群只聊技术"), "记住：这个群只聊技术");
eq("叫我 X", learn.extractRule("以后叫我小鱼就好"), "叫我小鱼就好");
eq("普通聊天不抽", learn.extractRule("今天好热啊"), null);
eq("问句不抽", learn.extractRule("你不要这样行吗"), "不要这样行吗");
eq("超长不抽", learn.extractRule("不要" + "啊".repeat(200)), null);
// ── 存规矩 ──
const pk = peerKey('group', 'G1');
learn.forgetRules(pk);
ok.push(["第一次记规矩", learn.learnRule({ peerKey: pk, text: "不要客套", by: "U-OWNER" }).ok === true]);
const r2 = learn.learnRule({ peerKey: pk, text: "不要老是客套", by: "U-OWNER" });
ok.push(["同意思覆盖不新增", r2.updated === true && learn.rulesFor(pk).length === 1, learn.rulesFor(pk)]);
for (let i = 0; i < 25; i++) learn.learnRule({ peerKey: pk, text: "记住：第" + i + "条测试规矩", by: "U-OWNER" });
ok.push(["最多留 20 条", (learn.loadLearn().rules[pk] || []).length === 20, (learn.loadLearn().rules[pk] || []).length]);
ok.push(["注入只取最后 5 条", learn.rulesFor(pk).length === 5, learn.rulesFor(pk)]);
ok.push(["forgetRules 能清空", learn.forgetRules(pk) > 0 && learn.rulesFor(pk).length === 0]);
// ── 反馈学习 ──
learn.markSent(pk);
ok.push(["发完等着被接", learn.markReacted(pk) === true]);
ok.push(["回应率算得对", learn.replyRate(pk).reacted === 1 && learn.replyRate(pk).sent === 1, learn.replyRate(pk)]);
ok.push(["没在等的时候不算", learn.markReacted(pk) === false]);
learn.markSent(pk, Date.now() - 10 * 60 * 1000);
ok.push(["超过 3 分钟不算回应", learn.markReacted(pk) === false]);
ok.push(["样本不足倍率为 1", learn.adaptiveFactor(pk) === 1, learn.adaptiveFactor(pk)]);
const pkHi = peerKey('group', 'G-HI');
for (let i = 0; i < 12; i++) { learn.markSent(pkHi); learn.markReacted(pkHi) }
ok.push(["每次都被接 → 倍率 1.4", learn.adaptiveFactor(pkHi) === 1.4, learn.adaptiveFactor(pkHi)]);
const pkLo = peerKey('group', 'G-LO');
for (let i = 0; i < 12; i++) learn.markSent(pkLo);
ok.push(["没人接 → 倍率 0.6", learn.adaptiveFactor(pkLo) === 0.6, learn.adaptiveFactor(pkLo)]);
console.log("=== 学习 单元测试 ===");
let fail = 0;
for (const [n, pass, extra, want] of ok) { console.log((pass ? "OK  " : "FAIL ") + n + (pass ? "" : "   got=" + JSON.stringify(extra) + " want=" + JSON.stringify(want))); if (!pass) fail++ }
console.log(fail ? ("失败 " + fail) : "全部通过");
process.exit(fail ? 1 : 0);
