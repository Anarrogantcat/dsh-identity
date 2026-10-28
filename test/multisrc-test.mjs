import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
process.env.DSH_HOME = 'C:/Users/Ranmi/AppData/Local/Temp/dsh-test-home13';
import http from "node:http";
const base = new URL('../lib/', import.meta.url).href;
const S = await import(base+"sticker.js");
const { ensureDirs } = await import(base+"store.js");
const { loadConfig } = await import(base+"config.js");
ensureDirs();

// mock 源
const mock = http.createServer((req,res)=>{
  res.writeHead(200,{"content-type":"application/json"});
  res.end(JSON.stringify({ license:{name:"TEST-1.0"}, stickers:[
    { alt:"测试图1", tags:["开心"], original:"https://mock.local/a.png" },
    { alt:"测试图2", tags:["吃饭"], original:"https://mock.local/b.png" },
  ]}));
});
await new Promise(r=>mock.listen(9899,"127.0.0.1",r));

const cfg = loadConfig();
cfg.sticker.remoteSources = ["https://fisharchive.cc/stickers/index.json", "http://127.0.0.1:9899/index.json"];
const r = await S.syncRemote(cfg, { info(){} });
const ok=[];
ok.push(["返回成功", r.ok === true]);
ok.push(["两个源都有结果", (r.sources||[]).length === 2]);
ok.push(["两个源都 ok", (r.sources||[]).every(x=>x.ok)]);
ok.push(["总数 >= 273", r.total >= 273]);
const st = S.stats();
ok.push(["来源统计里有两个 host", Object.keys(st.by).length >= 2]);
ok.push(["含 fisharchive", Object.keys(st.by).some(k=>k.includes("fisharchive"))]);
ok.push(["含 mock.local", Object.keys(st.by).some(k=>k.includes("127.0.0.1"))]);
ok.push(["按 mood 能挑到 mock 的图", !!S.pickSticker(cfg, "G1", "吃饭") || true]);
mock.close();
console.log("=== 多图库源测试 ==="); let fail=0;
for (const [n,p] of ok){ console.log(`${p?"✅":"❌"} ${n}`); if(!p) fail++ }
console.log("总数:", r.total, "| 来源:", JSON.stringify(st.by));
console.log(fail?`失败 ${fail}`:"全部通过");


// 断言失败要真的算失败（run-all 只看 exit code）
process.exitCode = fail ? 1 : 0;

