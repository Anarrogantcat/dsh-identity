import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
process.env.DSH_HOME = 'C:/Users/Ranmi/AppData/Local/Temp/dsh-test-home' // __TEST_HOME__ 隔离，绝不写真实配置
const base = new URL('../lib/', import.meta.url).href;
const M = await import(base + "mgmt.js");
const { loadConfig, saveConfig, clone, DEFAULTS } = await import(base + "config.js");
const { ensureDirs } = await import(base + "store.js");
ensureDirs();
const ok = [];
const kinds = ["groups","dmUsers","owners","admins","memoryPeers","stickers","audit","biliSubs","usage"];
for (const k of kinds) {
  const d = M.list(k);
  ok.push([`数据源 ${k}`, Array.isArray(d.rows) && typeof d.hint === "string"]);
}
ok.push(["加群", M.op("groups","add",{value:"g-demo"}).ok === true]);
ok.push(["列表含新群", M.list("groups").rows.some(r => r.value === "g-demo")]);
ok.push(["删群", M.op("groups","remove",{value:"g-demo"}).ok === true]);
ok.push(["空值拒绝", M.op("groups","add",{value:""}).ok === false]);
ok.push(["UP mid 校验", M.op("biliSubs","add",{value:"abc"}).ok === false]);
ok.push(["UP mid 正常", M.op("biliSubs","add",{value:"12345"}).ok === true]);
M.op("biliSubs","remove",{value:"12345"});
ok.push(["重置计数", M.op("usage","reset",{}).ok === true]);
ok.push(["清角色缓存", M.op("roles","clearCache",{}).ok === true]);
const bad = M.op("nope","add",{value:"x"});
ok.push(["未知数据源报错", bad.ok === false]);
saveConfig(clone(DEFAULTS));
console.log("=== 管理数据源测试 ==="); let fail=0;
for (const [n,p] of ok){ console.log(`${p?"✅":"❌"} ${n}`); if(!p) fail++ }
console.log(fail?`失败 ${fail}`:"全部通过");


// 断言失败要真的算失败（run-all 只看 exit code）
process.exitCode = fail ? 1 : 0;

