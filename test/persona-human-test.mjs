import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
process.env.DSH_HOME = 'C:/Users/Ranmi/AppData/Local/Temp/dsh-test-persona';
import { mkdirSync, rmSync } from "node:fs";
const HOME = process.env.DSH_HOME;
try { rmSync(HOME, { recursive: true, force: true }) } catch {}
mkdirSync(HOME + "/profiles/desktop", { recursive: true });
const base = new URL('../', import.meta.url).href;
const { DEFAULT_PERSONA } = await import(base + "lib/persona.js");
const BANNED = ["希望对你有帮助", "如有需要", "很高兴为你解答", "很高兴为您服务", "总的来说"];
const stripQuotes = (s) => String(s).replace(/[「『"][^」』"]*[」』"]/g, "");
const ok = [];
// 风格库（presets.js）已下线，人设只剩内核默认段；这里守住它的质量底线
ok.push(["默认人设非空", typeof DEFAULT_PERSONA === 'string' && DEFAULT_PERSONA.length >= 80, DEFAULT_PERSONA.length]);
ok.push(["默认人设不长（<= 400 字）", DEFAULT_PERSONA.length <= 400, DEFAULT_PERSONA.length]);
ok.push(["默认人设不含客服禁语（引号里的反例不算）", BANNED.every((w) => !stripQuotes(DEFAULT_PERSONA).includes(w))]);
ok.push(["默认人设明确「不是客服」", DEFAULT_PERSONA.includes("不是客服")]);
ok.push(["默认人设要求该短就短、不写报告", /该短就短/.test(DEFAULT_PERSONA) && /报告/.test(DEFAULT_PERSONA)]);
ok.push(["默认人设要求不复读/不罗列", /复读/.test(DEFAULT_PERSONA) && /不罗列/.test(DEFAULT_PERSONA)]);
ok.push(["默认人设有不装人/承认 AI 的边界", /AI/.test(DEFAULT_PERSONA) && /承认/.test(DEFAULT_PERSONA)]);
ok.push(["默认人设有不泄露本机信息的边界", /不透露本机/.test(DEFAULT_PERSONA)]);
ok.push(["默认人设不假装知道", /不知道就说不知道/.test(DEFAULT_PERSONA)]);
console.log("=== 默认人设 测试 ===");
let fail = 0;
for (const [n, p] of ok) { console.log(`${p ? "✅" : "❌"} ${n}`); if (!p) fail++ }
console.log(fail ? `失败 ${fail}` : "全部通过");

// 断言失败要真的算失败（run-all 只看 exit code）
process.exitCode = fail ? 1 : 0;
