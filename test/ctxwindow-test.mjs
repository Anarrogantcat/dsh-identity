process.env.DSH_HOME = 'C:/Users/Ranmi/AppData/Local/Temp/dsh-test-ctxwin';
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
const HOME = process.env.DSH_HOME;
try { rmSync(HOME, { recursive: true, force: true }) } catch {}
mkdirSync(HOME + "/profiles/desktop", { recursive: true });
writeFileSync(HOME + "/profiles/desktop/cordis.patch.yml", "- id: im-qqbot\n  config:\n    appId: '1905982004'\n    appSecret: dummy\n", "utf8");
const { pathToFileURL } = await import("node:url");
const { homedir } = await import("node:os");
const { join } = await import("node:path");
const base = new URL('../', import.meta.url).href;
const { ensureDirs } = await import(base + "lib/store.js");
ensureDirs();
const C = await import(base + "lib/ctxwindow.js");
const ok = []; const A = (n, c, e) => ok.push([n, !!c, e]);
A("正常长句：给 4 条", C.contextLinesFor(4, "今晚那场比赛打得也太离谱了吧") === 4);
A("纯「不」：窗口翻倍到 8", C.contextLinesFor(4, "不") === 8);
A("「嗯」也翻倍", C.contextLinesFor(4, "嗯") === 8);
A("「所以呢」翻倍", C.contextLinesFor(4, "所以呢") === 8);
A("「这算什么」翻倍", C.contextLinesFor(4, "这算什么") === 8);
A("普通短句不翻倍（≥9 字）", C.contextLinesFor(4, "看起来还行吧今天呢") === 4);
A("上限 30", C.contextLinesFor(20, "不") === 30);
A("关掉上下文（0）就始终 0", C.contextLinesFor(0, "不") === 0);
console.log("=== 自适应上下文 测试 ===");
let fail = 0;
for (const [n, pass, e] of ok) { console.log((pass ? "OK  " : "FAIL ") + n + (pass ? "" : "   " + JSON.stringify(e || {}).slice(0, 140))); if (!pass) fail++; }
console.log(fail ? ("失败 " + fail) : ("全部通过 " + ok.length + "/" + ok.length));
await new Promise((r) => setTimeout(r, 150));
process.exitCode = fail ? 1 : 0;
