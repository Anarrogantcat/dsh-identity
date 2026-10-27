process.env.DSH_HOME = 'C:/Users/Ranmi/AppData/Local/Temp/dsh-test-automem';
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
const HOME = process.env.DSH_HOME;
try { rmSync(HOME, { recursive: true, force: true }) } catch {}
mkdirSync(HOME + "/profiles/desktop", { recursive: true });
writeFileSync(HOME + "/profiles/desktop/cordis.patch.yml", "- id: im-qqbot\n  config:\n    appId: '1905982004'\n    appSecret: dummy\n", "utf8");
const base = "file:///C:/Users/Ranmi/.dsh/profiles/desktop/node_modules/dsh-qqbot-refine/";
const { ensureDirs } = await import(base + "lib/store.js");
ensureDirs();
const A = await import(base + "lib/automem.js");
const MEM = await import(base + "lib/memory.js");
const { clone, DEFAULTS } = await import(base + "lib/config.js");
const ok = []; const T = (n, c, e) => ok.push([n, !!c, e]);
const cfg = clone(DEFAULTS);
// 1) 能捡出事实
T("「我住在成都」能记", A.extractFacts('我住在成都，平时上班').includes('我住在成都'), A.extractFacts('我住在成都，平时上班'));
T("「我不吃香菜」能记", A.extractFacts('我不吃香菜').some((x) => x.includes('不吃香菜')), A.extractFacts('我不吃香菜'));
T("「周末要考试」能记", A.extractFacts('这周末要考试，好烦').some((x) => /考试/.test(x)), A.extractFacts('这周末要考试，好烦'));
T("「我这周末要考试」也能记", A.extractFacts('我这周末要考试').some((x) => /考试/.test(x)), A.extractFacts('我这周末要考试'));
// 2) 不记的
T("问句不记", A.extractFacts('我住在哪？').length === 0, A.extractFacts('我住在哪？'));
T("玩笑不记", A.extractFacts('我喜欢你哈哈哈').length === 0, A.extractFacts('我喜欢你哈哈哈'));
T("假设不记", A.extractFacts('如果我住在火星').length === 0, A.extractFacts('如果我住在火星'));
T("别人说的不记（第三人称）", A.extractFacts('他住在成都').length === 0, A.extractFacts('他住在成都'));
// 3) 写进记忆卡，标 auto
const n = A.autoRemember('g_auto', '我住在成都', { uid: 'u1', nick: '小明', cfg });
const list = MEM.listMemory('g_auto');
T("真的写进去了", n >= 1 && list.some((x) => /我住在成都/.test(x.text)), { n, list });
// 4) 同名重复不重复记
const n2 = A.autoRemember('g_auto', '我住在成都', { uid: 'u1', cfg });
const count = MEM.listMemory('g_auto').filter((x) => /我住在成都/.test(x.text)).length;
T("重复的不会堆两条", count === 1, { n2, count });
// 5) 关掉开关就不记
const cfg2 = clone(DEFAULTS); cfg2.memory.auto = false;
const n3 = A.autoRemember('g_auto', '我喜欢打游戏', { uid: 'u3', cfg: cfg2 });
T("开关关了就不记", n3 === 0);
console.log("=== 自动记忆 测试 ===");
let fail = 0;
for (const [n4, pass, e] of ok) { console.log((pass ? "OK  " : "FAIL ") + n4 + (pass ? "" : "   " + JSON.stringify(e || {}).slice(0, 180))); if (!pass) fail++; }
console.log(fail ? ("失败 " + fail) : ("全部通过 " + ok.length + "/" + ok.length));
await new Promise((r) => setTimeout(r, 150));
process.exitCode = fail ? 1 : 0;
