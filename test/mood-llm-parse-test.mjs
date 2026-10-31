import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
process.env.USERPROFILE = process.env.USERPROFILE || 'C:/Users/Example';
process.env.DSH_HOME = process.env.DSH_HOME || 'C:/dsh-test-temp/dsh-test-mparse';
import { mkdirSync, rmSync } from "node:fs";
try { rmSync(process.env.DSH_HOME, { recursive: true, force: true }) } catch {}
mkdirSync(process.env.DSH_HOME + "/profiles/desktop", { recursive: true });
const base = new URL('../', import.meta.url).href;
const L2 = await import(base + "lib/moodllm.js");
const M = await import(base + "lib/moodlocal.js");
const { ensureDirs } = await import(base + "lib/store.js");
const { loadConfig, saveConfig, clone, DEFAULTS } = await import(base + "lib/config.js");
ensureDirs();
const ok = [];
const T = (name, cond, extra) => ok.push([name, !!cond, extra]);
// 各种真实会遇到的模型输出
T("纯 JSON", (() => { const r = L2.parseAppraisal('{"happy":1,"sad":0.5,"reason":"被怼了"}'); return r && r.dims.happy === 1 && r.reason === "被怼了" })());
T("带代码块围栏", (() => { const r = L2.parseAppraisal('```json\n{"happy":0.8,"reason":"夸她"}\n```'); return r && r.dims.happy === 0.8 })());
T("前后带解释文字", (() => { const r = L2.parseAppraisal('好的，我判断：{"sad":1.4,"reason":"被骂"} 就是这样。'); return r && r.dims.sad === 1.4 })());
T("中文引号", (() => { const r = L2.parseAppraisal('{“happy”:1.2,“reason”:“被夸可爱”}'); return r && r.dims.happy === 1.2 && r.reason === "被夸可爱" })());
T("数字带引号", (() => { const r = L2.parseAppraisal('{"happy":"1.5","sweet":"0.4"}'); return r && r.dims.happy === 1.5 })());
T("尾逗号", (() => { const r = L2.parseAppraisal('{"happy":1,"sweet":0.5,}'); return r && r.dims.happy === 1 })());
T("根本不是 JSON（正则抠）", (() => { const r = L2.parseAppraisal('happy: 1.2, sweet: 0.6, reason: 被夸了'); return r && r.dims.happy === 1.2 && r.reason === "被夸了" })());
T("超范围夹到 ±2", (() => { const r = L2.parseAppraisal('{"happy":9,"sad":-9}'); return r && r.dims.happy === 2 && r.dims.sad === -2 })());
T("完全无关 → null", L2.parseAppraisal('我觉得大家都挺开心的') === null);
T("空字符串 → null", L2.parseAppraisal('') === null);
// 熔断：连续 3 次解析失败后暂停
M.resetLocalMood();
const cfg = clone(DEFAULTS);
Object.assign(cfg.integration, { llmEnabled: true, llmProvider: "p", llmModel: "m", llmEvery: 5, llmDailyTokens: 20000 });
saveConfig(cfg);
const badLlm = { stream: async function* () { yield { text: '今天大家都很开心' } } };
for (let i = 0; i < 3; i++) { for (let k = 0; k < 3; k++) L2.pushMessage("g1", "随便聊聊 " + k, "member"); await L2.appraiseWithLlm(cfg, badLlm, "g1") }
T("3 次失败后暂停", L2.isPaused() === true, L2.llmStats());
T("暂停时不再调模型", (await L2.appraiseWithLlm(cfg, badLlm, "g1")).error.includes("暂停"));
T("暂停时记录了原始输出", (L2.llmStats().lastRaw || "").length > 0, L2.llmStats().lastRaw);
L2.resetLlmState();
T("重置后恢复可用", L2.isPaused() === false);
// 成功一次清掉失败计数
for (let k = 0; k < 3; k++) L2.pushMessage("g2", "谢谢大肥鱼好厉害 " + k, "member");
const goodLlm = { stream: async function* () { yield { text: '{"happy":1.2,"reason":"被夸"}' } } };
const r1 = await L2.appraiseWithLlm(cfg, goodLlm, "g2");
T("正常输出能成功", r1.ok === true, r1);
T("成功后失败计数归零", L2.llmStats().failStreak === 0);
console.log("=== 心情评估解析 / 熔断 测试 ===");
let fail = 0;
for (const [n, pass, extra] of ok) { console.log((pass ? "OK  " : "FAIL ") + n + (pass ? "" : "   " + JSON.stringify(extra))); if (!pass) fail++ }
console.log(fail ? ("失败 " + fail) : "全部通过");
process.exit(fail ? 1 : 0);
