import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
process.env.DSH_HOME = 'C:/Users/Ranmi/AppData/Local/Temp/dsh-test-home';
const base=pathToFileURL(join(homedir(), '.dsh', 'profiles', 'desktop', 'node_modules', 'dsh-qqbot-refine', 'lib/')).href;
const P = await import(base+"presets.js");
const { ensureDirs } = await import(base+"store.js");
ensureDirs();
const ok=[];
const created = P.savePreset({ name:"可编辑测试", text:"原始正文内容，用来测试编辑。" });
ok.push(["新建", !!created.id && created.source==="imported"]);
const upd = P.savePreset({ id: created.id, name:"改过的名字", text:"改过的正文，长度够。" });
ok.push(["按 id 更新（编辑生效）", upd.name==="改过的名字"]);
const got = P.getPresetText(created.id);
ok.push(["更新后可读回", got.text.includes("改过的正文")]);
let threw=false; try { P.savePreset({ id:"feiyu-group", name:"x", text:"y".repeat(10) }) } catch(e){ threw=true }
ok.push(["内置不可改（需另存）", threw]);
const dup = P.savePreset({ name:"群聊短句（副本）", text:"另存为的正文内容，长度足够。" });
ok.push(["另存为新", dup.id !== "feiyu-group"]);
P.deletePreset(created.id); P.deletePreset(dup.id);
console.log("=== 人设编辑测试 ==="); let fail=0;
for (const [n,p] of ok){ console.log(`${p?"✅":"❌"} ${n}`); if(!p) fail++ }
console.log(fail?`失败 ${fail}`:"全部通过");
