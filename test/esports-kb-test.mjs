import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
process.env.DSH_HOME = 'C:/Users/Ranmi/AppData/Local/Temp/dsh-test-esports';
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
const HOME = process.env.DSH_HOME;
try { rmSync(HOME, { recursive: true, force: true }) } catch {}
mkdirSync(HOME + "/profiles/desktop", { recursive: true });
writeFileSync(HOME + "/profiles/desktop/cordis.patch.yml", "- id: im-qqbot\n  config:\n    appId: '1905982004'\n    appSecret: dummy-secret-for-test\n", "utf8");
const base = pathToFileURL(join(homedir(), '.dsh', 'profiles', 'desktop', 'node_modules', 'dsh-qqbot-refine')).href + '/';
const E = await import(base + "lib/esports.js");
const K = await import(base + "lib/knowledge.js");
const { ensureDirs, peerKey } = await import(base + "lib/store.js");
ensureDirs();
const ok = [];
// 赛事：录入 + 检索 + 交手
const r1 = E.addMatch({ date: "2026-10-25", team1: "HLE", team2: "IG", score: "1:2", winner: "IG", league: "Worlds 2026", note: "瑞士轮 R3" });
ok.push(["能录入一条", r1.ok === true && r1.total === 1, r1]);
E.addMatch({ date: "2026-10-20", team1: "GEN", team2: "HLE", score: "2:0", winner: "GEN" });
ok.push(["按队名搜得到", E.searchMatches("IG").length === 1, E.searchMatches("IG")]);
ok.push(["交手记录按两队搜", E.headToHead("ig", "hle").length === 1]);
ok.push(["交手不相关队为空", E.headToHead("IG", "T1").length === 0]);
const f = E.formatMatches(E.searchMatches("HLE"));
ok.push(["文本里有比分和胜者", /HLE vs IG/.test(f) && /1:2/.test(f) && /IG 胜/.test(f), f]);
const r2 = E.addMatch({ date: "2026-10-25", team1: "HLE", team2: "IG", score: "2:1", winner: "HLE" });
ok.push(["同一天两队覆盖不重复", r2.total === 2, r2.total]);
ok.push(["空库文案诚实", /本地还没有记录/.test(E.formatMatches([]))]);
ok.push(["统计给面板用", E.matchStats().total === 2 && E.matchStats().teams >= 3, E.matchStats()]);
// 知识库
const dir = K.ensureKb();
await (await import("node:fs")).promises.writeFile(dir + "/common.md", "# 公共\n## 常用链接\n- 项目仓库 https://example.test/repo\n## 术语\n- 白饭 = token\n", "utf8");
const pk = peerKey("group", "G1");
await (await import("node:fs")).promises.writeFile(dir + "/" + pk + ".md", "# 本群\n## 群规\n- 不聊政治、不发色图\n## 赛季\n- 周末打排位\n", "utf8");
const hits = K.searchKnowledge("群规是什么", pk);
ok.push(["知识库能命中群规", hits.length > 0 && /群规|政治/.test(hits[0].text + hits[0].title), hits]);
ok.push(["common 对所有群生效", K.searchKnowledge("白饭 是什么", pk).length > 0]);
const other = peerKey("group", "G2");
ok.push(["别的群看不到本群规矩", K.searchKnowledge("群规是什么", other).every(h => h.peerKey === "common")]);
K.noteQuery(pk, "群规记得吗");
const block = K.knowledgeBlock(K.lastQueryOf(pk), pk);
ok.push(["命中的资料能注入", /这个群的资料/.test(block) && /政治|色图/.test(block), block.slice(0, 120)]);
ok.push(["没命中就不注入", K.knowledgeBlock("今晚吃什么好呢", pk) === ""]);
ok.push(["标题列表可列", K.listTitles(pk).some(t => /群规/.test(t.title))]);
console.log("=== 赛事库 / 知识库 测试 ===");
let fail = 0;
for (const [n, pass, extra] of ok) { console.log((pass ? "OK  " : "FAIL ") + n + (pass ? "" : "   " + JSON.stringify(extra))); if (!pass) fail++ }
console.log(fail ? ("失败 " + fail) : "全部通过");
process.exit(fail ? 1 : 0);
