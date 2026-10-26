process.env.DSH_HOME = 'C:/Users/Ranmi/AppData/Local/Temp/dsh-test-mp';
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
const HOME = process.env.DSH_HOME;
try { rmSync(HOME, { recursive: true, force: true }) } catch {}
mkdirSync(HOME + "/profiles/desktop", { recursive: true });
const base = "file:///C:/Users/Ranmi/.dsh/profiles/desktop/node_modules/dsh-qqbot-refine/";
const M = await import(base + "lib/moodllm.js");
const ok = []; const T = (n, c, e) => ok.push([n, !!c, e]);
const j = '{"happy":0,"calm":0,"sweet":0,"heartache":0,"worry":0,"sad":0,"jealous":0}';
const p1 = M.parseAppraisal('先说一句废话 ' + j);
T("JSON 前面有解释也能解析", p1 && p1.complete, p1);
const p2 = M.parseAppraisal('{"happy":1.5,"calm":0,"sweet":0,"heartache":0,"worry":0,"sad":0,"jealous":0} 后面还有话');
T("JSON 后面有解释也能解析", p2 && p2.dims.happy === 1.5, p2);
const p3 = M.parseAppraisal('第一段 {乱写的} 然后 ' + j);
T("前面有假花括号也不影响（从后往前找）", p3 && p3.complete, p3);
T("完全没 JSON 仍判失败", M.parseAppraisal("今天大家都在聊比赛，气氛挺好") === null);
console.log("=== 心情解析健壮性 ===");
let fail = 0;
for (const [n, pass, e] of ok) { console.log((pass ? "OK  " : "FAIL ") + n + (pass ? "" : "   " + JSON.stringify(e))); if (!pass) fail++; }
console.log(fail ? ("失败 " + fail) : "全部通过 " + ok.length + "/" + ok.length);
process.exit(fail ? 1 : 0);
