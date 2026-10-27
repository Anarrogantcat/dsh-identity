import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
process.env.DSH_HOME = 'C:/Users/Ranmi/AppData/Local/Temp/dsh-test-fix';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { execFileSync } from 'node:child_process';
const HOME = process.env.DSH_HOME;
try { rmSync(HOME, { recursive: true, force: true }) } catch {}
mkdirSync(HOME + "/profiles/desktop", { recursive: true });
writeFileSync(HOME + "/profiles/desktop/cordis.patch.yml", "- id: im-qqbot\n  config:\n    appId: '1905982004'\n    appSecret: dummy\n", "utf8");
const base = pathToFileURL(join(homedir(), '.dsh', 'profiles', 'desktop', 'node_modules', 'dsh-qqbot-refine')).href + '/';
const { ensureDirs } = await import(base + "lib/store.js");
ensureDirs();
const F = await import(base + "lib/fix.js");
const BT = String.fromCharCode(96);
const fence = BT + BT + BT;
const ok = []; const T = (n, c, e) => ok.push([n, !!c, e]);
// 1) 抓 diff 块（带解释、多个块取最后一个）
const msg = '原因是这样。\n' + fence + 'diff\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n' + fence + '\n完事';
const d = F.extractDiff(msg);
T("能抓出 diff 块", d.includes("--- a/x") && d.includes("+b"), d.slice(0, 60));
F.noteDiff('G1', msg);
T("补丁进等待区", !!F.peekDiff("G1"));
// 2) 真实仓库上合并
const repo = HOME + '/repo';
execFileSync('git', ['init', '-q'], { cwd: HOME });
mkdirSync(repo, { recursive: true });
execFileSync('git', ['init', '-q'], { cwd: repo });
writeFileSync(repo + '/a.txt', 'v1\n');
execFileSync('git', ['add', '.'], { cwd: repo });
execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init'], { cwd: repo });
const patch = '--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-v1\n+v2\n';
const r1 = await F.applyFix(patch, { cwd: repo });
T("好补丁能合上", r1.ok === true, r1);
T("文件内容真的变了", readFileSync(repo + "/a.txt", "utf8").trim() === "v2");
// 3) 打不上的补丁要拒绝
const bad = '--- a/none.txt\n+++ b/none.txt\n@@ -1 +1 @@\n-x\n+y\n';
const r2 = await F.applyFix(bad, { cwd: repo });
T("坏补丁被拒且不改文件", r2.ok === false && /打不上/.test(r2.message), r2);
// 4) 没有补丁时的提示
const r3 = await F.applyFix("", { cwd: repo });
T("空补丁给明确提示", r3.ok === false && /没有待合并/.test(r3.message), r3);
console.log("=== 诊断→合并 流程 测试 ===");
let fail = 0;
for (const [n, pass, e] of ok) { console.log((pass ? "OK  " : "FAIL ") + n + (pass ? "" : "   " + JSON.stringify(e || {}).slice(0, 160))); if (!pass) fail++; }
console.log(fail ? ("失败 " + fail) : ("全部通过 " + ok.length + "/" + ok.length));
await new Promise((r) => setTimeout(r, 200));
process.exitCode = fail ? 1 : 0;
