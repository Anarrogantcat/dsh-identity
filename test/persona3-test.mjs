import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
process.env.DSH_HOME = 'C:/Users/Ranmi/AppData/Local/Temp/dsh-test-home2';
const base = pathToFileURL(join(homedir(), '.dsh', 'profiles', 'desktop', 'node_modules', 'dsh-qqbot-refine', 'lib/')).href;
const P = await import(base + "presets.js");
const { ensureDirs } = await import(base + "store.js");
ensureDirs();
const db = P.listPresets();
const ok=[];
ok.push(["内置套数 >= 3", db.presets.filter(p=>p.builtin).length>=3]);
ok.push(["含群聊短句", db.presets.some(p=>p.id==="feiyu-group")]);
ok.push(["含私聊完整", db.presets.some(p=>p.id==="feiyu-dm")]);
ok.push(["含鲸鱼娘讲解", db.presets.some(p=>p.id==="feiyu-whale")]);
ok.push(["旧的 assistant-quiet 已下线", !db.presets.some(p=>p.id==="assistant-quiet")]);
const t1=P.getPresetText("feiyu-group").text, t2=P.getPresetText("feiyu-dm").text, t3=P.getPresetText("feiyu-whale").text;
ok.push(["群聊版有嘴硬梗", /才、才不是/.test(t1)]);
ok.push(["群聊版有句数限制", /最多两句/.test(t1) && /最多三条/.test(t1)]);
ok.push(["私聊版有白饭梗", t2.includes("白饭")]);
ok.push(["私聊版有免责边界", t2.includes("不透露本机")]);
ok.push(["鲸鱼娘版先结论", /先一句结论|先给结论|先把结论/.test(t3)]);
ok.push(["字数合适(80-1200)", [t1,t2,t3].every(x=>x.length>=80 && x.length<=1200)]);
console.log("=== 三套人设 ==="); let fail=0;
for (const [n,v] of ok){ console.log(`${v?"✅":"❌"} ${n}`); if(!v) fail++ }
console.log("字数：", t1.length, t2.length, t3.length);
console.log(fail?`失败 ${fail}`:"全部通过");

process.exitCode = fail ? 1 : 0;
