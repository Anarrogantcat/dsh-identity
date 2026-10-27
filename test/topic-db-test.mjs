import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
process.env.DSH_HOME = 'C:/Users/Ranmi/AppData/Local/Temp/dsh-test-topic2';
import { mkdirSync, rmSync } from "node:fs";
try { rmSync(process.env.DSH_HOME, { recursive: true, force: true }) } catch {}
mkdirSync(process.env.DSH_HOME + "/profiles/desktop", { recursive: true });
const base = pathToFileURL(join(homedir(), '.dsh', 'profiles', 'desktop', 'node_modules', 'dsh-qqbot-refine')).href + '/';
const T = await import(base + "lib/topic.js");
const E = await import(base + "lib/esports.js");
const { ensureDirs } = await import(base + "lib/store.js");
ensureDirs();
const ok = [];
const A = (n, c, e) => ok.push([n, !!c, e]);
const today = (() => { const d = new Date(); const p2 = (x) => String(x).padStart(2,'0'); return d.getFullYear() + '-' + p2(d.getMonth()+1) + '-' + p2(d.getDate()) })();
// 1) 库是空的：什么都不认，注入里明说别猜
A("空库：认不出对局", T.identifyFromText("今天 IG vs HLE 怎么打") === null);
A("空库：注入明说别猜", /不要自己指定/.test(T.topicBlock("g1")), T.topicBlock("g1"));
// 2) 库里有今天这场：才认
E.addMatch({ date: today, team1: "IG", team2: "HLE", league: "Worlds 2026", score: "" });
const id1 = T.identifyFromText("IG vs HLE 这场你怎么看");
A("库里有的对局才认", id1 && id1.kind === "today" && id1.match.team1 === "IG", id1);
A("注入带上今天的赛程", /IG vs HLE/.test(T.topicBlock("g1")), T.topicBlock("g1").slice(0, 80));
// 3) 历史：库里有 + 明确历史词
E.addMatch({ date: "2026-05-10", team1: "HLE", team2: "IG", league: "MSI 2026", score: "3:2" });
const id2 = T.identifyFromText("上次 MSI IG 被 HLE 让二追三");
A("历史场次要明确历史词才认", id2 && id2.kind === "history", id2);
// 4) 库里没有的对局：不猜
A("库里没有的对局 → 不认", T.identifyFromText("TES vs G2 谁赢") === null);
// 5) 选手外号不算队名
A("选手外号不参与判定（Kanavi/TheShy）", T.identifyFromText("Kanavi 和 TheShy 谁更强") === null);
A("外号+队名混着说也不硬凑", T.identifyFromText("Kanavi 打 IG 怎么样") === null, T.identifyFromText("Kanavi 打 IG 怎么样"));
A("外号黑名单里有 Kanavi", T.PLAYER_NICKS.has("kanavi"));
// 6) 统计
A("统计能看到今天几条", T.topicStats().today === 1, T.topicStats());
console.log("=== 赛程指向（只认库）测试 ===");
let fail = 0;
for (const [n, pass, e] of ok) { console.log((pass ? "OK  " : "FAIL ") + n + (pass ? "" : "   " + JSON.stringify(e))); if (!pass) fail++ }
console.log(fail ? ("失败 " + fail) : "全部通过");
process.exit(fail ? 1 : 0);
