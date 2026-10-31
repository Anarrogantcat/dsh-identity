import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
process.env.DSH_HOME = process.env.DSH_HOME || 'C:/dsh-test-temp/dsh-test-tones';
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
try { rmSync(process.env.DSH_HOME, { recursive: true, force: true }) } catch {}
const base = new URL('../', import.meta.url).href;
const mood = await import(base + "lib/mood.js");
const { dirs } = await import(base + "lib/store.js");
mkdirSync(dirs.root, { recursive: true });
// 心情来源只剩本地引擎：直接写 moodlocal.json 的七维，分数由维度算出
const write = (dims) => writeFileSync(join(dirs.root, 'moodlocal.json'), JSON.stringify({ dims, at: Date.now() }));
const cases = [["松快", {happy:9,calm:5}], ["平和", {happy:3,calm:5}], ["有点闷", {worry:5}], ["低落", {sad:9,heartache:6}], ["别扭", {jealous:8}]];
const ok = [];
const tones = [];
for (const [name, dims] of cases) {
  write(dims);
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
ok.push(["没有心情文件时返回 null", (() => { rmSync(join(dirs.root, 'moodlocal.json'), { force: true }); return mood.moodToneOf(mood.readMood()) === null })()]);
console.log("=== 心情→人设 适配测试 ===");
let fail = 0;
for (const [n, pass, extra] of ok) { console.log((pass ? "OK  " : "FAIL ") + n + (pass ? "" : "   " + JSON.stringify(extra))); if (!pass) fail++ }
console.log(fail ? ("失败 " + fail) : "全部通过");
process.exit(fail ? 1 : 0);
