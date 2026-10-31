import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
process.env.DSH_HOME = process.env.DSH_HOME || 'C:/dsh-test-temp/dsh-test-mllm';
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
const HOME = process.env.DSH_HOME;
try { rmSync(HOME, { recursive: true, force: true }) } catch {}
mkdirSync(HOME + "/profiles/desktop", { recursive: true });
const base = new URL('../', import.meta.url).href;
const L2 = await import(base + "lib/moodllm.js");
const M = await import(base + "lib/moodlocal.js");
const { ensureDirs } = await import(base + "lib/store.js");
const { loadConfig, saveConfig, clone, DEFAULTS } = await import(base + "lib/config.js");
ensureDirs();
const ok = [];
const cfg = (patch = {}) => { const c = clone(DEFAULTS); Object.assign(c.integration, { llmEnabled: true, llmProvider: 'p', llmModel: 'm', llmEvery: 5, llmDailyTokens: 20000 }, patch); return c };
// 1) 解析：正常 JSON / 带废话 / 超范围夹紧 / 坏输出
const j1 = L2.parseAppraisal('{"happy":1.5,"sweet":1,"reason":"被夸了"}');
ok.push(["能解析 JSON", j1 && j1.dims.happy === 1.5 && j1.reason === '被夸了', j1]);
const j2 = L2.parseAppraisal('好的：\n{"happy":9,"sad":-5,"reason":"夹一下"}');
ok.push(["超范围夹到 ±2", j2.dims.happy === 2 && j2.dims.sad === -2, j2.dims]);
ok.push(["坏输出 → null", L2.parseAppraisal('我不太确定') === null]);
ok.push(["全 0 且无理由 → null", L2.parseAppraisal('{"happy":0,"sad":0}') === null]);
// 2) 攒消息 + 调模型
M.resetLocalMood();
for (let i = 0; i < 6; i++) L2.pushMessage('g_test', '谢谢你，大肥鱼好厉害 ' + i, 'member');
ok.push(["缓冲攒到 6 条", L2.bufferSize('g_test') === 6]);
const fakeLlm = { stream: async function* () { yield { text: '{"happy":1.2,"sweet":0.8,"reason":"夸她厉害"}' } } };
const r1 = await L2.appraiseWithLlm(cfg(), fakeLlm, 'g_test');
ok.push(["评估成功", r1.ok === true, r1]);
ok.push(["七维变化落到本地心情", M.readLocalMood().dims.happy > 0, M.readLocalMood().dims]);
ok.push(["理由落盘", L2.llmStats().lastReason === '夸她厉害', L2.llmStats()]);
ok.push(["评估后清空缓冲", L2.bufferSize('g_test') === 0]);
// 3) 预算闸
const tiny = cfg({ llmDailyTokens: 60 });
for (let i = 0; i < 6; i++) L2.pushMessage('g_budget', '随便聊聊 ' + i, 'member');
const r2 = await L2.appraiseWithLlm(tiny, fakeLlm, 'g_budget');
ok.push(["预算用完 → 不再调用", r2.ok === false && /预算/.test(r2.error), r2]);
ok.push(["预算剩余为 0", L2.budgetLeft(tiny) === 0, L2.budgetLeft(tiny)]);
// 4) 没配置 provider → 不调
const r3 = await L2.appraiseWithLlm(cfg({ llmProvider: '', llmModel: '' }), fakeLlm, 'g_test');
ok.push(["没 provider 就跳过", r3.ok === false, r3]);
// 5) 模型输出乱 → 不崩、不污染心情
const beforeDims = JSON.stringify(M.readLocalMood().dims);
for (let i = 0; i < 3; i++) L2.pushMessage('g_bad', '哈哈 ' + i, 'member');
const badLlm = { stream: async function* () { yield { text: '我觉得大家都挺开心的' } } };
const r4 = await L2.appraiseWithLlm(cfg(), badLlm, 'g_bad');
ok.push(["坏输出：返回失败", r4.ok === false, r4]);
ok.push(["坏输出：心情没被改", JSON.stringify(M.readLocalMood().dims) === beforeDims]);
ok.push(["坏输出记了失败原因", /JSON/.test(L2.llmStats().lastError), L2.llmStats().lastError]);
// 6) 抛异常也不崩
const boomLlm = { stream: async function* () { throw new Error('rate limit') } };
for (let i = 0; i < 3; i++) L2.pushMessage('g_err', '在吗 ' + i, 'member');
const r5 = await L2.appraiseWithLlm(cfg(), boomLlm, 'g_err');
ok.push(["模型抛错 → 优雅失败", r5.ok === false && /rate limit/.test(r5.error), r5]);
// 7) 理由不进提示词
const idx = (await import("node:fs")).readFileSync(new URL('../lib/mood.js', import.meta.url), "utf8");
const block = (await import(base + "lib/mood.js")).moodBlock({ score: 70, tone: '松快', hint: 'h', rules: ['r'], particles: ['p'] });
ok.push(["注入段落里没有理由字段", !/lastReason|理由/.test(block), block]);
ok.push(["心情段落不含具体聊天内容", !/夸她厉害/.test(block), block]);
console.log("=== 模型评估心情 测试 ===");
let fail = 0;
for (const [n, pass, extra] of ok) { console.log((pass ? "OK  " : "FAIL ") + n + (pass ? "" : "   " + JSON.stringify(extra))); if (!pass) fail++ }
console.log(fail ? ("失败 " + fail) : "全部通过");
process.exit(fail ? 1 : 0);
