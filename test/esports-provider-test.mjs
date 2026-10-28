import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
process.env.DSH_HOME = 'C:/Users/Ranmi/AppData/Local/Temp/dsh-test-esports-provider';

import { mkdirSync, writeFileSync, rmSync } from "node:fs";
const HOME = process.env.DSH_HOME;
try { rmSync(HOME, { recursive: true, force: true }) } catch {}
mkdirSync(HOME + "/profiles/desktop", { recursive: true });

const base = new URL('../', import.meta.url).href;
const E = await import(base + "lib/esports.js");
const K = await import(base + "lib/knowledge.js");
const { ensureDirs, peerKey } = await import(base + "lib/store.js");
const { loadConfig, saveConfig, clone, DEFAULTS } = await import(base + "lib/config.js");
ensureDirs();

const ok = [];
const add = (name, pass, extra) => ok.push([name, pass, extra]);
const pk = peerKey("group", "G1");
const pkOther = peerKey("group", "G9");

// ── chunk 生成 ──
add("空库 → 没有 chunk", E.chunks().length === 0);
E.addMatch({ date: "2026-10-25", league: "Worlds 2026", team1: "HLE", team2: "IG", score: "1:2", winner: "IG", note: "瑞士轮 R3", source: "用户录入" });
const cs = E.chunks();
add("录入一条赛程 → 出现 1 个 chunk", cs.length === 1, cs);
const c0 = cs[0] ?? {};
add("chunk 形状是 {title, body, keywords}", typeof c0.title === "string" && typeof c0.body === "string" && typeof c0.keywords === "string", c0);
add("title = 日期 + 两队 + 联赛", c0.title === "2026-10-25 HLE vs IG（Worlds 2026）", c0.title);
add("body 含比分/胜者/备注/来源", /比分 1:2/.test(c0.body) && /IG 胜/.test(c0.body) && /备注 瑞士轮 R3/.test(c0.body) && /来源：用户录入/.test(c0.body), c0.body);
add("keywords 含队名/联赛/备注/日期", ["HLE", "IG", "Worlds", "瑞士轮", "2026-10-25"].every((w) => c0.keywords.includes(w)), c0.keywords);
add("比分没填时 body 说「待补」", (() => {
  E.addMatch({ date: "2026-10-26", league: "Worlds 2026", team1: "T1", team2: "GEN", note: "瑞士轮 R4" });
  return E.chunks().some((c) => /T1 vs GEN/.test(c.title) && /比分待补/.test(c.body));
})(), E.chunks().map((c) => c.body));

// ── 排序 / 上限 / 覆盖 ──
add("按日期倒序（最新在前）", E.chunks()[0].title.startsWith("2026-10-26"), E.chunks().map((c) => c.title));
add("同日同两队覆盖不重复", (() => {
  E.addMatch({ date: "2026-10-26", team1: "T1", team2: "GEN", score: "2:1", winner: "T1", league: "Worlds 2026" });
  return E.chunks().filter((c) => /T1 vs GEN/.test(c.title)).length === 1;
})(), E.chunks().length);
add("chunks(limit) 能截断", E.chunks(1).length === 1);
add("最多 200 条", (() => {
  for (let i = 0; i < 205; i++) E.addMatch({ date: "2026-09-" + String((i % 28) + 1).padStart(2, "0"), team1: "A" + i, team2: "B" + i, score: "2:0", winner: "A" + i });
  return E.chunks().length === 200 && E.chunks(999).length === 200;
})(), E.loadMatches().length);

// ── provider 接进知识库 ──
add("providers = md + esports", K.providers.length === 2 && K.providers[0].name === "md" && K.providers[1].name === "esports", K.providers.map((p) => p.name));
const dir = K.ensureKb();
writeFileSync(dir + "/common.md", "# 公共\n## 常用链接\n- 项目仓库 https://example.test/repo\n\n## 术语\n- 白饭 = token（她自己的叫法）\n", "utf8");
writeFileSync(dir + "/" + pk + ".md", "# 本群\n## 群规\n- 不聊政治、不发色图\n", "utf8");
writeFileSync(dir + "/" + pkOther + ".md", "# 别的群\n## 暗号\n- 今晚八点开黑\n", "utf8");
const all = await K.loadAllChunks();
add("loadAllChunks 合并 md + esports", all.some((c) => c.peerKey === "esports") && all.some((c) => c.peerKey === "common") && all.some((c) => c.peerKey === pk), all.map((c) => c.peerKey));
add("esports chunk 归一成 {peerKey,title,text,keywords}", (() => {
  const c = all.find((x) => x.peerKey === "esports");
  return !!c && typeof c.title === "string" && typeof c.text === "string" && typeof c.keywords === "string";
})(), all.find((x) => x.peerKey === "esports"));

// ── 自然问句命中赛程 ──
const hit = K.searchKnowledge("昨天 IG 那场谁赢了", pk);
add("自然问句能检索到赛程 chunk", hit.length > 0 && hit[0].peerKey === "esports" && /IG/.test(hit[0].title + hit[0].text), hit);
const hit2 = K.searchKnowledge("HLE 和 IG 谁赢了", pk);
add("「HLE 和 IG 谁赢了」也命中赛程", hit2.some((h) => h.peerKey === "esports"), hit2.map((h) => h.peerKey));
const block = K.knowledgeBlock("昨天 IG 那场谁赢了", pk, { top: 2 });
add("命中的赛程能注入人设段", /这个群的资料/.test(block) && /IG/.test(block), block.slice(0, 160));
add("别的群也能看到赛程（跨群可见）", K.searchKnowledge("昨天 IG 那场谁赢了", pkOther).some((h) => h.peerKey === "esports"));
add("别的群的 markdown 不外泄", K.searchKnowledge("今晚八点开黑", pk).every((h) => h.peerKey !== pkOther), K.searchKnowledge("今晚八点开黑", pk));
add("md 检索仍能命中群规", (() => { const h = K.searchKnowledge("群规是什么", pk); return h.length > 0 && h[0].peerKey === pk && /政治|色图/.test(h[0].text); })(), K.searchKnowledge("群规是什么", pk));

// ── 统计 ──
const st = K.kbStats();
add("kbStats 有 esports 条数", st.esports === E.chunks().length && st.esports > 0, st.esports);
add("kbStats.providers 计数正确", st.providers && st.providers.esports === st.esports && st.providers.md === st.chunks && st.providerCount === 2, st.providers);
add("kbStats.all = md + esports", st.all === st.chunks + st.esports, st);
add("kbStats.per 仍按群统计 md", (st.per[pk] ?? 0) >= 1 && (st.per["esports"] ?? 0) === 0, st.per);

// ── injectChars 接上配置 ──
add("缺省注入 400 字", K.injectCharsOf(clone(DEFAULTS)) === 400 && K.DEFAULT_INJECT_CHARS === 400, K.injectCharsOf(clone(DEFAULTS)));
add("非法值回落缺省", K.injectCharsOf({ knowledge: { injectChars: "abc" } }) === 400 && K.injectCharsOf({}) === 400);
writeFileSync(dir + "/common.md", "# 公共\n## 长资料\n- " + "白饭".repeat(250) + "\n", "utf8");
const blockDefault = K.knowledgeBlock("白饭 是什么", pk);
add("默认 400 字上限生效", blockDefault.length > 0 && blockDefault.split("\n").filter((l) => !l.startsWith("#")).every((l) => l.length <= 400), blockDefault.length);
const cfg = clone(DEFAULTS);
cfg.knowledge.injectChars = 150;
saveConfig(cfg);
add("cfg.knowledge.injectChars 读进来", K.injectCharsOf(loadConfig()) === 150, K.injectCharsOf(loadConfig()));
const blockSmall = K.knowledgeBlock("白饭 是什么", pk);
add("注入正文按 150 字截断", blockSmall.length > 0 && blockSmall.split("\n").filter((l) => !l.startsWith("#")).every((l) => l.length <= 150), blockSmall.split("\n").map((l) => l.length));

// ── 坏数据不抛 ──
writeFileSync(E.MATCH_PATH, "这 不是 json", "utf8");
add("matches.json 坏掉 → chunks() 返回 [] 不抛", (() => { try { return Array.isArray(E.chunks()) && E.chunks().length === 0; } catch { return false; } })());
add("赛程坏掉时 kbStats 仍能算", (() => { try { const s = K.kbStats(); return s.esports === 0 && s.chunks >= 1; } catch { return false; } })());
writeFileSync(E.MATCH_PATH, JSON.stringify([]), "utf8");

console.log("=== 赛程 chunk / 知识库 provider 测试 ===");
let fail = 0;
for (const [n, pass, extra] of ok) { console.log((pass ? "OK  " : "FAIL ") + n + (pass ? "" : "   " + JSON.stringify(extra))); if (!pass) fail++ }
console.log(fail ? ("失败 " + fail) : ("全部通过 " + (ok.length - fail) + "/" + ok.length));
process.exit(fail ? 1 : 0);
