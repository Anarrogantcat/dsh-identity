process.env.DSH_HOME = 'C:/Users/Ranmi/AppData/Local/Temp/dsh-test-persona';
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
const HOME = process.env.DSH_HOME;
try { rmSync(HOME, { recursive: true, force: true }) } catch {}
mkdirSync(HOME + "/profiles/desktop", { recursive: true });
const base = "file:///C:/Users/Ranmi/.dsh/profiles/desktop/node_modules/dsh-qqbot-refine/";
const { BUILTIN, loadPresets, resolvePreset } = await import(base + "lib/presets.js");
const { DEFAULT_PERSONA } = await import(base + "lib/persona.js");
const { ensureDirs } = await import(base + "lib/store.js");
ensureDirs();
const BANNED = ["希望对你有帮助", "如有需要", "很高兴为你解答", "很高兴为您服务", "总的来说"];
const ok = [];
ok.push(["内置人设 4 条", BUILTIN.length === 4, BUILTIN.length]);
ok.push(["文本版本已升到 3（会覆盖旧版）", BUILTIN.every(p => p.textVersion === 3)]);
for (const b of BUILTIN) {
  const t = b.text;
  ok.push([b.id + " 不含客服禁语", BANNED.every(w => !t.includes(w))]);
  ok.push([b.id + " 有「不复读/不重复」要求", /不复读|不重复/.test(t)]);
  ok.push([b.id + " 有节奏要求（一两句）", /一句|两句|短句/.test(t)]);
  ok.push([b.id + " 长度 <= 700 字", t.length <= 700, t.length]);
}
ok.push(["默认人设够短（<= 400 字）", DEFAULT_PERSONA.length <= 400, DEFAULT_PERSONA.length]);
ok.push(["默认人设也不含客服禁语", BANNED.every(w => !DEFAULT_PERSONA.includes(w))]);
ok.push(["默认人设明确「不是客服」", DEFAULT_PERSONA.includes("不是客服")]);
for (const b of BUILTIN) ok.push([b.id + " 有「别装人/承认 AI」边界", /AI/.test(b.text)]);
const db = loadPresets();
ok.push(["落盘 presets.json 可读且已迁移", Array.isArray(db.presets) && db.presets.length >= 4, db.presets.map(p=>p.id)]);
ok.push(["已下线的 assistant-quiet 被清掉", !db.presets.some(p => p.id === 'assistant-quiet')]);
const src = (id) => db.presets.find(p => p.id === id).text;
ok.push(["加载后的正文已是新版（不是旧存档）", src('feiyu-group').includes('不客套'), src('feiyu-group').slice(0, 20)]);
const cfg = { persona: { text: '' } };
const r = resolvePreset(cfg, 'group', 'G-TEST');
ok.push(["群聊解析到内置人设", !!r && r.text.length > 50, r && r.id]);
console.log("=== 人设（像人）测试 ===");
let fail = 0;
for (const [n, pass, extra] of ok) { console.log((pass ? "OK  " : "FAIL ") + n + (pass ? "" : "   " + JSON.stringify(extra))); if (!pass) fail++ }
console.log(fail ? ("失败 " + fail) : "全部通过");
process.exit(fail ? 1 : 0);
