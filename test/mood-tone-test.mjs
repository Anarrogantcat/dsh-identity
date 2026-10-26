process.env.DSH_HOME = 'C:/Users/Ranmi/AppData/Local/Temp/dsh-test-tones';
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
try { rmSync(process.env.DSH_HOME, { recursive: true, force: true }) } catch {}
mkdirSync(process.env.DSH_HOME + "/feiyu-mood", { recursive: true });
const base = "file:///C:/Users/Ranmi/.dsh/profiles/desktop/node_modules/dsh-qqbot-refine/";
const mood = await import(base + "lib/mood.js");
const write = (s, dims) => writeFileSync(process.env.DSH_HOME + "/feiyu-mood/state.json", JSON.stringify({ version:2, lastActive:"fish", moods:{ fish:{ mood:s, dims } } }));
const cases = [["松快", 80, {happy:9,calm:5}], ["平和", 55, {happy:3,calm:5}], ["有点闷", 35, {worry:5}], ["低落", 18, {sad:9,heartache:6}], ["别扭", 52, {jealous:8}]];
const ok = [];
const tones = [];
for (const [name, s, dims] of cases) {
  write(s, dims);
  const t = mood.moodToneOf(mood.readMood());
  tones.push(t);
  ok.push([name + " 档位对", t.tone === name, t.tone]);
  ok.push([name + " 有 3 条具体行为", Array.isArray(t.rules) && t.rules.length === 3, t.rules]);
  ok.push([name + " 有口癖建议", t.particles.length >= 1]);
}
const texts = tones.map(t => t.tone + "|" + t.rules.join("/"));
ok.push(["五种心情的行为互不相同", new Set(texts).size === 5, texts]);
ok.push(["边界：低落不撒娇", tones[3].rules.some(r => /不撒娇/.test(r))]);
ok.push(["边界：别扭要嘴硬", tones[4].rules.some(r => /嘴硬/.test(r))]);
ok.push(["边界：松快可以接梗", tones[0].rules.some(r => /接个梗/.test(r))]);
console.log("=== 心情→人设 适配测试 ===");
let fail = 0;
for (const [n, pass, extra] of ok) { console.log((pass ? "OK  " : "FAIL ") + n + (pass ? "" : "   " + JSON.stringify(extra))); if (!pass) fail++ }
console.log(fail ? ("失败 " + fail) : "全部通过");
process.exit(fail ? 1 : 0);
