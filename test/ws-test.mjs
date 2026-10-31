import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
process.env.DSH_HOME = process.env.DSH_HOME || 'C:/dsh-test-temp/dsh-test-home10';
const base = new URL('../', import.meta.url).href;
const T = await import(base+"lib/toolgate.js");
const { ensureDirs, dirs } = await import(base+"lib/store.js");
ensureDirs();
const os = await import("node:os");
const cfg = { tools: { restrictToWorkspace: true, workspaceRoots: [] } };
const ok=[];
const inside = process.cwd() + "\\somefile.txt";
const outsideWin = "C:\\Users\\" + os.userInfo().username + "\\.dsh\\.credentials.yaml";
const outsideDrive = "D:\\AI\\其它东西\\secret.txt";

ok.push(["工作区内相对/绝对路径放行", T.outsidePath({ file_path: inside }, cfg) === null]);
ok.push(["相对路径放行", T.outsidePath({ file_path: "src/index.js" }, cfg) === null]);
ok.push(["~/.dsh 拒绝", T.outsidePath({ file_path: "~/.dsh/.credentials.yaml" }, cfg) !== null]);
ok.push(["家目录下 .dsh 拒绝", T.outsidePath({ file_path: outsideWin }, cfg) !== null]);
ok.push(["别的盘拒绝", T.outsidePath({ file_path: outsideDrive }, cfg) !== null]);
ok.push(["插件临时目录放行", T.outsidePath({ file_path: dirs.tmp + "\\x.png" }, cfg) === null]);
ok.push(["数组参数也检查", T.outsidePath({ files: [inside, outsideDrive] }, cfg) === null ? false : true]);
const cfg2 = { tools: { restrictToWorkspace: true, workspaceRoots: ["D:\\AI\\其它东西"] } };
ok.push(["追加根目录后放行", T.outsidePath({ file_path: outsideDrive }, cfg2) === null]);
const cfg3 = { tools: { restrictToWorkspace: false } };
ok.push(["关掉限制后放行", T.outsidePath({ file_path: outsideDrive }, cfg3) === null]);
console.log("cwd =", process.cwd());
console.log("=== 工作区限制测试 ==="); let fail=0;
for (const [n,p] of ok){ console.log(`${p?"✅":"❌"} ${n}`); if(!p) fail++ }
console.log(fail?`失败 ${fail}`:"全部通过");

// 断言失败要真的算失败（run-all 只看 exit code）
process.exitCode = fail ? 1 : 0;

