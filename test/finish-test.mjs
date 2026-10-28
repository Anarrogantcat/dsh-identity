import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
process.env.DSH_HOME = 'C:/Users/Ranmi/AppData/Local/Temp/dsh-test-home' // __TEST_HOME__ 隔离，绝不写真实配置
const base = new URL('../', import.meta.url).href;
const M = await import(base+"lib/memory.js");
const P = await import(base+"lib/profile.js");
const B = await import(base+"lib/bili.js");
const C = await import(base+"lib/card.js");
const { loadConfig, saveConfig, clone, DEFAULTS } = await import(base+"lib/config.js");
const { ensureDirs, peerKey } = await import(base+"lib/store.js");
const { renderToFile } = C;
ensureDirs();
const ok=[];
const pk = peerKey("group","g-finish");
const cfg = loadConfig();

// 1) 记忆 TTL
const old = new Date(Date.now()-400*86400000).toISOString();
M.addMemory(pk, { text:"很久以前的一条流水账", category:"event", importance:0.1, at: old }, cfg);
M.addMemory(pk, { text:"很久以前但很重要的事", category:"stable_profile", importance:0.9, at: old }, cfg);
M.addMemory(pk, { text:"昨天的新事", category:"event", importance:0.5 }, cfg);
const removed = M.prunePeer(pk, 180);
ok.push(["TTL 清掉旧的流水账", removed === 1]);
const left = M.listMemory(pk).map(x=>x.text).join("|");
ok.push(["保留长期事实", left.includes("很重要")]);
ok.push(["保留新事", left.includes("昨天")]);

// 2) 召回队列
M.queueRecall(pk, "新事");
ok.push(["召回队列可取", M.takePendingRecall(pk) === "新事"]);
ok.push(["取过即空", M.takePendingRecall(pk) === null]);

// 3) B站卡片数据 → 渲染
const info = { bvid:"BV1xx411c7mD", title:"测试视频标题", owner:"某UP", duration:605, view:12345, desc:"简介" };
const pick = { h:480, size: 12*1048576 };
const data = B.biliCardData(info, pick, cfg);
ok.push(["B站卡片有标题", data.title.includes("测试视频标题")]);
ok.push(["B站卡片有时长", data.subtitle.includes("10:05")]);
const p1 = await renderToFile(data, "bili-test");
ok.push(["B站卡片渲染成功", !!p1]);

// 4) yt-dlp 缺失时优雅降级
const clip = await B.clipViaYtDlp(cfg, "https://www.bilibili.com/video/BV1xx411c7mD", 0, 30, "C:/nonexistent/x.mp4");
ok.push(["无 yt-dlp 时返回失败而非抛错", clip.ok === false && typeof clip.error === "string"]);

// 5) 画像语义归纳：未配置时明确拒绝
const r = await P.induceLlm("g-finish", clone(DEFAULTS), null);
ok.push(["未配置 llm 时拒绝", r.ok === false && /未配置/.test(r.error)]);

saveConfig(clone(DEFAULTS));
console.log("=== 收尾功能测试 ==="); let fail=0;
for (const [n,v] of ok){ console.log(`${v?"✅":"❌"} ${n}`); if(!v) fail++ }
console.log(fail?`失败 ${fail}`:"全部通过");
if (p1) console.log("卡片:", p1);


// 断言失败要真的算失败（run-all 只看 exit code）
process.exitCode = fail ? 1 : 0;

