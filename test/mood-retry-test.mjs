import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
process.env.DSH_HOME = process.env.DSH_HOME || 'C:/dsh-test-temp/dsh-test-moodretry';
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
const HOME = process.env.DSH_HOME;
try { rmSync(HOME, { recursive: true, force: true }) } catch {}
mkdirSync(HOME + "/profiles/desktop", { recursive: true });
writeFileSync(HOME + "/profiles/desktop/cordis.patch.yml", "- id: im-qqbot\n  config:\n    appId: '1905982004'\n    appSecret: dummy\n", "utf8");
const base = new URL('../', import.meta.url).href;
const { ensureDirs } = await import(base + "lib/store.js");
ensureDirs();
const M = await import(base + "lib/moodllm.js");
const { clone, DEFAULTS, saveConfig } = await import(base + "lib/config.js");
const ok = []; const T = (n, c, e) => ok.push([n, !!c, e]);
const cfg = clone(DEFAULTS);
Object.assign(cfg.integration, { llmEnabled: true, llmProvider: 'p', llmModel: 'm', llmEvery: 2, llmDailyTokens: 50000 });
saveConfig(cfg);
for (let i = 0; i < 3; i++) M.pushMessage('g9', '今天好累啊 ' + i, 'member');
let calls = 0;
const llm = { stream: async function* () {
  calls += 1;
  if (calls === 1) { yield { type: 'reasoning-delta', text: '想' }; yield { type: 'finish', reason: { kind: 'length' } }; return }
  yield { type: 'text-delta', text: '{"sad":0.8,"reason":"累了"}' };
  yield { type: 'finish', reason: 'stop' };
} };
const r = await M.appraiseWithLlm(cfg, llm, 'g9');
T("正文为空时会自动重试一次", calls >= 2, calls);
T("重试后能拿到 JSON", r.ok === true && r.dims && r.dims.sad === 0.8, r);
M.resetLlmState();
for (let i = 0; i < 3; i++) M.pushMessage('g9', '烦死了 ' + i, 'member');
const bad = { stream: async function* () { yield { type: 'reasoning-delta', text: '想' }; yield { type: 'finish', reason: { kind: 'length' } } } };
const r2 = await M.appraiseWithLlm(cfg, bad, 'g9');
T("错误信息里 finish 是对象也不会串成 [object Object]", r2.ok === false && !String(r2.error).includes('[object Object]'), r2);
console.log("=== 心情模型评估重试 测试 ===");
let fail = 0;
for (const [n, pass, e] of ok) { console.log((pass ? "OK  " : "FAIL ") + n + (pass ? "" : "   " + JSON.stringify(e || {}).slice(0, 160))); if (!pass) fail++; }
console.log(fail ? ("失败 " + fail) : ("全部通过 " + ok.length + "/" + ok.length));
await new Promise((r) => setTimeout(r, 200));
process.exitCode = fail ? 1 : 0;
