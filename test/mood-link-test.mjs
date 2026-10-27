import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
process.env.DSH_HOME = 'C:/Users/Ranmi/AppData/Local/Temp/dsh-test-home4';
const fs = await import("node:fs"); const path = await import("node:path");
const home = process.env.DSH_HOME; fs.mkdirSync(path.join(home,"feiyu-mood"), { recursive: true });
const base = pathToFileURL(join(homedir(), '.dsh', 'profiles', 'desktop', 'node_modules', 'dsh-qqbot-refine', 'lib/')).href;
const M = await import(base + "mood.js");
const ok=[];
function setMood(mood, dims){ fs.writeFileSync(path.join(home,"feiyu-mood","state.json"), JSON.stringify({version:2,moods:{__default__:{mood,dims}},lastActive:"__default__"})) }
// 无文件时
fs.rmSync(path.join(home,"feiyu-mood","state.json"),{force:true});
ok.push(["缺文件不崩", M.readMood({ integration: { moodSource: 'auto' } }) === null && M.stickerMoodOf(null)==="开心"]);

setMood(85,{happy:0.9,calm:0.1,sweet:0.2,heartache:0,worry:0,sad:0,jealous:0});
ok.push(["开心→开心", M.stickerMoodOf(M.readMood({ integration: { moodSource: 'auto' } }))==="开心"]);
ok.push(["心情高→概率1.35", Math.abs(M.probabilityFactor(M.readMood({ integration: { moodSource: 'auto' } }))-1.35)<0.01]);
ok.push(["心情高→cute", M.voiceStyleOf(M.readMood({ integration: { moodSource: 'auto' } }))==="cute"]);

setMood(20,{happy:0,calm:0.1,sweet:0,heartache:0.8,worry:0.2,sad:0.6,jealous:0});
ok.push(["难过→委屈", M.stickerMoodOf(M.readMood({ integration: { moodSource: 'auto' } }))==="委屈"]);
ok.push(["心情低→概率0.7", Math.abs(M.probabilityFactor(M.readMood({ integration: { moodSource: 'auto' } }))-0.7)<0.01]);
ok.push(["心情低→gentle", M.voiceStyleOf(M.readMood({ integration: { moodSource: 'auto' } }))==="gentle"]);

setMood(60,{happy:0,calm:0.1,sweet:0.7,heartache:0,worry:0,sad:0,jealous:0});
ok.push(["甜→害羞", M.stickerMoodOf(M.readMood({ integration: { moodSource: 'auto' } }))==="害羞"]);

setMood(55,{happy:0,calm:0.2,sweet:0,heartache:0,worry:0,sad:0,jealous:0.9});
ok.push(["嫉妒→生气", M.stickerMoodOf(M.readMood({ integration: { moodSource: 'auto' } }))==="生气"]);

ok.push(["摘要可读", M.moodSummary(M.readMood({ integration: { moodSource: 'auto' } })).includes("心情")]);
console.log("=== 心情联动测试 ==="); let fail=0;
for(const [n,v] of ok){ console.log(`${v?"✅":"❌"} ${n}`); if(!v) fail++ }
console.log(fail?`失败 ${fail}`:"全部通过");

// 断言失败要真的算失败（run-all 只看 exit code）
process.exitCode = fail ? 1 : 0;

