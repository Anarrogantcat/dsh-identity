import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
process.env.DSH_HOME = 'C:/Users/Ranmi/AppData/Local/Temp/dsh-test-home4';
const fs = await import("node:fs"); const path = await import("node:path");
const base = new URL('../lib/', import.meta.url).href;
const M = await import(base + "mood.js");
const { dirs } = await import(base + "store.js");
fs.mkdirSync(dirs.root, { recursive: true });
// 心情只有一个来源：本地 moodlocal.json（旧的第三方 feiyu-mood 读取器已移除）
function setMood(dims){ fs.writeFileSync(path.join(dirs.root, "moodlocal.json"), JSON.stringify({ dims, at: Date.now() })) }
const rm = () => fs.rmSync(path.join(dirs.root, "moodlocal.json"), { force: true });
const ok=[];
rm();
ok.push(["缺文件不崩", M.readMood() === null && M.stickerMoodOf(null)==="开心"]);

setMood({happy:9,calm:1,sweet:2});
const hi = M.readMood();
ok.push(["开心→开心", M.stickerMoodOf(hi)==="开心"]);
ok.push(["心情高→概率 > 1 且等于 0.5+分数/100", Math.abs(M.probabilityFactor(hi)-(0.5+hi.mood/100))<1e-9 && M.probabilityFactor(hi)>1, M.probabilityFactor(hi)]);
ok.push(["心情高→cute", M.voiceStyleOf(hi)==="cute"]);

setMood({sad:8,heartache:8,worry:2});
const lo = M.readMood();
ok.push(["难过→委屈", M.stickerMoodOf(lo)==="委屈"]);
ok.push(["心情低→概率 < 1", M.probabilityFactor(lo)<1 && Math.abs(M.probabilityFactor(lo)-(0.5+lo.mood/100))<1e-9, M.probabilityFactor(lo)]);
ok.push(["心情低→gentle", M.voiceStyleOf(lo)==="gentle"]);

setMood({sweet:7,happy:2});
ok.push(["甜→害羞", M.stickerMoodOf(M.readMood())==="害羞"]);

setMood({jealous:9});
ok.push(["嫉妒→生气", M.stickerMoodOf(M.readMood())==="生气"]);

setMood({calm:4, happy:6});
ok.push(["摘要可读", M.moodSummary(M.readMood()).includes("心情")]);
ok.push(["没有状态时的中性值", M.probabilityFactor(null)===1 && M.proactiveFactor(null)===1 && M.voiceStyleOf(null)===null]);
console.log("=== 心情联动测试 ==="); let fail=0;
for(const [n,v] of ok){ console.log(`${v?"✅":"❌"} ${n}`); if(!v) fail++ }
console.log(fail?`失败 ${fail}`:"全部通过");

// 断言失败要真的算失败（run-all 只看 exit code）
process.exitCode = fail ? 1 : 0;
