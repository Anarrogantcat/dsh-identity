import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
process.env.DSH_HOME = 'C:/Users/Ranmi/AppData/Local/Temp/dsh-test-home6';
const base = new URL('../lib/', import.meta.url).href;
const P = await import(base+"proactive.js");
const ok=[];
const cfgBase = { proactive: { mode:'hybrid', llmProvider:'p', llmModel:'m', llmOnlyWithMemory:true } };
// 新契约（2026-11-02）：说不出来就安静，绝不把模板直接发出去
// 1) 没配模型 → 安静
let r = await P.buildHybrid({ proactive:{ mode:'hybrid' } }, null, {});
ok.push(["hybrid 无模型 → 安静（null）", r === null]);
// 2) 有记忆才用模型（开关开）：
const fakeLlm = () => ({ async *stream() { yield { text: "改写后的句子" } } });
r = await P.buildHybrid(cfgBase, fakeLlm(), {});
ok.push(["无记忆话题 → 安静（null）", r === null]);
r = await P.buildHybrid(cfgBase, fakeLlm(), { memoryHint: "上次说的爬山" });
ok.push(["有记忆 → 模型润色", r?.source === "hybrid" && r.text.includes("改写")]);
// 3) 模型抛错 → 安静（以前会回落成模板句）
const badLlm = () => ({ async *stream() { throw new Error("boom") } });
r = await P.buildHybrid(cfgBase, badLlm(), { memoryHint: "上次说的爬山" });
ok.push(["模型失败 → 安静，不回落模板", r === null]);
// 4) 连续失败 3 次 → 冷却，冷却期间也安静
for (let i=0;i<3;i++) await P.buildHybrid(cfgBase, badLlm(), { memoryHint: "x" });
ok.push(["失败3次后进入冷却", P.llmHealthy() === false]);
r = await P.buildHybrid(cfgBase, fakeLlm(), { memoryHint: "x" });
ok.push(["冷却期间 → 安静", r === null]);
P.llmReset(); // 清掉冷却再测后面两项
const cfg2 = { proactive: { mode:'hybrid', llmProvider:'p', llmModel:'m', llmOnlyWithMemory:false } };
r = await P.buildHybrid(cfg2, fakeLlm(), {});
ok.push(["关掉限制 → 直接用模型", r?.source === "hybrid"]);
// 6) template 模式 = 不出声
r = await P.buildHybrid({ proactive:{ mode:'template' } }, fakeLlm(), { memoryHint:"x" });
ok.push(["template 模式 → 安静（null）", r === null]);
console.log("=== 混合模式测试 ==="); let fail=0;
for(const [n,v] of ok){ console.log(`${v?"✅":"❌"} ${n}`); if(!v) fail++ }
console.log(fail?`失败 ${fail}`:"全部通过");

process.exitCode = fail ? 1 : 0;
