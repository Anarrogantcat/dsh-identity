import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
process.env.DSH_HOME = 'C:/Users/Ranmi/AppData/Local/Temp/dsh-test-home5';
const base=pathToFileURL(join(homedir(), '.dsh', 'profiles', 'desktop', 'node_modules', 'dsh-qqbot-refine', 'lib/')).href;
const P = await import(base+"proactive.js");
const S = await import(base+"state.js");
const { ensureDirs } = await import(base+"store.js");
ensureDirs();
const ok=[];
ok.push(["时段判断", ["morning","afternoon","evening","night"].includes(P.timeBucket())]);
const t = P.buildTemplate({}, {});
ok.push(["模板生成", typeof t.text === "string" && t.text.length > 3 && t.source === "template"]);
const t2 = P.buildTemplate({}, { memoryHint: "上次说的那件事" });
ok.push(["记忆槽位", t2.text.includes("顺口问一句") && t2.source === "template+memory"]);
const hint = P.memoryHintOf([{text:"密码是 123"}, {text:"她说下周要去爬山"}]);
ok.push(["记忆提示过滤敏感", hint === "她说下周要去爬山"]);
ok.push(["llm 未配置时返回 null", (await P.buildWithLlm({proactive:{}}, null, {})) === null]);
// 状态
S.touchLastMsg("G1"); ok.push(["记录最后消息", S.lastMsgAt("G1") > 0]);
S.markProactive("G1"); ok.push(["记录主动时间", S.lastProactiveAt("G1") > 0]);
console.log("=== 主动搭话测试 ==="); let fail=0;
for(const [n,v] of ok){ console.log(`${v?"✅":"❌"} ${n}`); if(!v) fail++ }
console.log("示例模板:", t.text);
console.log(fail?`失败 ${fail}`:"全部通过");

