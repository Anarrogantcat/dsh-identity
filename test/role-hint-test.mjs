process.env.DSH_HOME = 'C:/Users/Ranmi/AppData/Local/Temp/dsh-test-home14';
const base="file:///C:/Users/Ranmi/.dsh/profiles/desktop/node_modules/dsh-qqbot-refine/lib/";
const R = await import(base+"roles.js");
const { ensureDirs } = await import(base+"store.js");
ensureDirs();
const cfg = { roles: { owners: ["OWNER"], admins: [], adminAutoFromQqOwner: true } };
const ok=[];
const t0=Date.now();
ok.push(["owner 列表命中", await R.resolveRole(cfg,"group","G","OWNER") === "owner"]);
ok.push(["hint=owner → admin", await R.resolveRole(cfg,"group","G","U1","owner") === "admin"]);
ok.push(["hint=admin → admin", await R.resolveRole(cfg,"group","G","U2","admin") === "admin"]);
ok.push(["hint=member → member", await R.resolveRole(cfg,"group","G","U3","member") === "member"]);
const ms = Date.now()-t0;
ok.push(["四次判定总耗时 < 50ms（说明没走网络）", ms < 50]);
ok.push(["关闭自动识别后 hint 无效", await R.resolveRole({roles:{owners:[],admins:[],adminAutoFromQqOwner:false}},"group","G","U4","admin") === "member"]);
ok.push(["手动 Admin 优先", await R.resolveRole({roles:{owners:[],admins:["U5"],adminAutoFromQqOwner:true}},"group","G","U5","member") === "admin"]);
console.log("=== 角色 hint 测试（耗时 "+ms+"ms）==="); let fail=0;
for (const [n,p] of ok){ console.log(`${p?"✅":"❌"} ${n}`); if(!p) fail++ }
console.log(fail?`失败 ${fail}`:"全部通过");
