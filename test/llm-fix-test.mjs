import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
process.env.DSH_HOME = process.env.DSH_HOME || 'C:/dsh-test-temp/dsh-test-llm2';
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
const HOME = process.env.DSH_HOME;
try { rmSync(HOME, { recursive: true, force: true }) } catch {}
mkdirSync(HOME + "/profiles/desktop", { recursive: true });
writeFileSync(HOME + "/profiles/desktop/cordis.patch.yml", "- id: im-qqbot\n  config:\n    appId: '1905982004'\n    appSecret: dummy\n", "utf8");
const base = new URL('../', import.meta.url).href;
const { ensureDirs } = await import(base + "lib/store.js");
ensureDirs();
const L = await import(base + "lib/llmtext.js");
const P = await import(base + "lib/profile.js");
const M = await import(base + "lib/moodllm.js");
const { clone, DEFAULTS, saveConfig } = await import(base + "lib/config.js");
const ok = []; const T = (n, c, e) => ok.push([n, !!c, e]);
// 1) collectStream 只取 text-delta，忽略 reasoning-delta
const fake = async function* () {
  yield { type: 'reasoning-delta', index: 0, text: '思考中……' };
  yield { type: 'text-delta', index: 0, text: '{"happy":1.2,' };
  yield { type: 'text-delta', index: 0, text: '"reason":"被夸"}' };
  yield { type: 'finish', reason: 'stop' };
};
const r1 = await L.collectStream({ stream: fake }, { provider: 'p', model: 'm', prompt: 'x' });
T("只拼正文，不拼思考", r1.text === "{\"happy\":1.2,\"reason\":\"被夸\"}", r1);
T("finish 被记录", r1.finish === "stop", r1.finish);
// 2) moodllm 用真 chunk 能解析
const cfg = clone(DEFAULTS);
Object.assign(cfg.integration, { llmEnabled: true, llmProvider: 'p', llmModel: 'm', llmEvery: 2, llmDailyTokens: 50000 });
saveConfig(cfg);
for (let i = 0; i < 3; i++) M.pushMessage('g1', '谢谢你，好厉害 ' + i, 'member');
const moodLlm = { stream: async function* () { yield { type: 'text-delta', text: '{"happy":1.2,"calm":0,"sweet":0.5,"heartache":0,"worry":0,"sad":0,"jealous":0,"reason":"被夸"}' }; yield { type: 'finish', reason: 'stop' } } };
const ra = await M.appraiseWithLlm(cfg, moodLlm, 'g1');
T("心情评估能拿到 JSON", ra.ok === true && ra.dims && ra.dims.happy === 1.2, ra);
// 3) 模型只吐 reasoning → 明确报错而不是静默
M.resetLlmState(); for (let i=0;i<3;i++) M.pushMessage('g1','今天好烦啊 '+i,'member');
const onlyThink = { stream: async function* () { yield { type: 'reasoning-delta', text: '想' }; yield { type: 'finish', reason: 'length' } } };
const rb = await M.appraiseWithLlm(cfg, onlyThink, 'g1');
T("只有思考内容时明确报错", rb.ok === false && /没有输出正文/.test(String(rb.error)), rb);
// 4) 画像：模型 traits 并入 tags，interests 不被覆盖成数组
const pc = clone(DEFAULTS); pc.profile.minMsgs7d = 3; pc.profile.llmProvider = 'p'; pc.profile.llmModel = 'm';
for (let i = 0; i < 5; i++) P.record(pc, '830148935', 'A1', '今天LPL谁打谁', false, {});
const llm2 = { stream: async function* () { yield { type: 'text-delta', text: '{"traits":["嘴硬但心软"],"interests":["电竞"],"toneHint":"可以损两句"}' }; yield { type: 'finish', reason: 'stop' } } };
const ri = await P.induceLlm('830148935', pc, llm2, 3);
P.induce('830148935', pc);
const mem = P.listMembers('830148935').find((m) => m.uid === 'A1');
T("模型归纳成功", ri.ok === true && ri.updated >= 1, ri);
T("模型 traits 进了 tags", !!(mem && mem.tags.some((t) => t.text === "嘴硬但心软")), mem && mem.tags);
T("interests 仍是计数对象", !!(mem && mem.interests && !Array.isArray(mem.interests) && (mem.interests.电竞 || 0) > 0), mem && mem.interests);
console.log("=== LLM 调用修复 测试 ===");
let fail = 0;
for (const [n, pass, e] of ok) { console.log((pass ? "OK  " : "FAIL ") + n + (pass ? "" : "   " + JSON.stringify(e || {}).slice(0, 200))); if (!pass) fail++; }
console.log(fail ? ("失败 " + fail) : ("全部通过 " + ok.length + "/" + ok.length));
process.exit(fail ? 1 : 0);
