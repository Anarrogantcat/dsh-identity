import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
process.env.DSH_HOME = 'C:/Users/Ranmi/AppData/Local/Temp/dsh-test-home5';
const base = new URL('../lib/', import.meta.url).href;
const P = await import(base+"proactive.js");
const S = await import(base+"state.js");
const { ensureDirs } = await import(base+"store.js");
ensureDirs();
const ok=[];
ok.push(["时段判断", ["morning","afternoon","evening","night"].includes(P.timeBucket())]);
const t = P.buildTemplate({}, {});
ok.push(["模板生成", typeof t.text === "string" && t.text.length > 3 && t.source === "template"]);
const t2 = P.buildTemplate({}, { memoryHint: "上次说的那件事" });
ok.push(["记忆槽位不泄露提示", !t2.text.includes("顺口问一句") && !t2.text.includes("上次说的那件事") && t2.source === "template+memory"]);
const hint = P.memoryHintOf([{text:"密码是 123"}, {text:"她说下周要去爬山"}]);
ok.push(["记忆提示过滤敏感", hint === "她说下周要去爬山"]);
ok.push(["llm 未配置时返回 null", (await P.buildWithLlm({proactive:{}}, null, {})) === null]);
// 真实事故：有人喊「大肥鱼睡不着」，4 秒后她先冒一句「刚才聊到哪儿了？我好像走神了。」
let sawDazou = false;
for (let i = 0; i < 300; i++) { if (P.buildTemplate({}, { reason: "刚才的话题还没接完" }).text.includes("走神")) sawDazou = true }
ok.push(["模板池里不再有「我走神了」", !sawDazou]);
// 刚有人说话要闭嘴
const nowMs = Date.now();
ok.push(["刚有人说话时先不插话", P.tooSoonAfterInbound(new Date(nowMs - 4000).toISOString(), nowMs, 60) === true]);
ok.push(["静了两分钟就可以开口", P.tooSoonAfterInbound(new Date(nowMs - 120000).toISOString(), nowMs, 60) === false]);
ok.push(["没有 inbound 记录时不拦", P.tooSoonAfterInbound('', nowMs, 60) === false]);
ok.push(["配 0 等于不拦", P.tooSoonAfterInbound(new Date(nowMs - 1000).toISOString(), nowMs, 0) === false]);
// 状态
S.touchLastMsg("G1"); ok.push(["记录最后消息", S.lastMsgAt("G1") > 0]);
S.markProactive("G1"); ok.push(["记录主动时间", S.lastProactiveAt("G1") > 0]);
console.log("=== 主动搭话测试 ==="); let fail=0;
for(const [n,v] of ok){ console.log(`${v?"✅":"❌"} ${n}`); if(!v) fail++ }
console.log("示例模板:", t.text);
console.log(fail?`失败 ${fail}`:"全部通过");


// 断言失败要真的算失败（run-all 只看 exit code）
process.exitCode = fail ? 1 : 0;

