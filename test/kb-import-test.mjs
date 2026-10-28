import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
process.env.DSH_HOME = 'C:/Users/Ranmi/AppData/Local/Temp/dsh-test-kbimp';
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
const HOME = process.env.DSH_HOME;
try { rmSync(HOME, { recursive: true, force: true }) } catch {}
mkdirSync(HOME + "/profiles/desktop", { recursive: true });
writeFileSync(HOME + "/profiles/desktop/cordis.patch.yml", "- id: im-qqbot\n  config:\n    appId: '1905982004'\n    appSecret: dummy\n", "utf8");
const base = new URL('../', import.meta.url).href;
const { ensureDirs } = await import(base + "lib/store.js");
ensureDirs();
const K = await import(base + "lib/knowledge.js");
const src = HOME + '/import-src';
mkdirSync(src, { recursive: true });
writeFileSync(src + '/群规.md', '# 群规\n禁止刷屏');
writeFileSync(src + '/faq.txt', 'Q: 怎么加群\nA: 找管理员');
writeFileSync(src + '/members.csv', 'name,role,note\n染喵,群主,爱吃\n穿云,管理,爱玩梗');
writeFileSync(src + '/data.json', JSON.stringify({ a: 1, b: '二' }));
writeFileSync(src + '/skip.bin', 'x');
const ok = []; const T = (n, c, e) => ok.push([n, !!c, e]);
const r = await K.importKbFromPath(src);
T("目录导入成功", r.ok && r.imported === 4, r);
const list = K.listKbFiles().map((x) => x.file);
T("四个文件都进了知识库", ["import-src-群规.md", "import-src-faq.md", "import-src-members.md", "import-src-data.md"].every((f) => list.includes(f)), list);
const kb = K.loadKnowledge();
T("chunks 里能检索到内容", kb.chunks.some((c) => String(c.text || "").includes("禁止刷屏")), kb.chunks.length);
const csvOk = kb.chunks.some((c) => /name: 染喵|role: 群主/.test(String(c.text || '')));
T("CSV 被转成键值对", csvOk, "csv");
const single = await K.importKbFromPath(src + '/群规.md', { asName: 'rule.md' });
T("单文件导入 + 指定文件名", single.ok && single.imported === 1 && K.listKbFiles().some((x) => x.file === "rule.md"), single);
const bad = await K.importKbFromPath(src + '/skip.bin');
T("不支持的类型被拒", bad.ok === false, bad);
const missing = await K.importKbFromPath(src + '/不存在.md');
T("路径不存在给提示", missing.ok === false && String(missing.error).includes("不存在"), missing);
// html：去掉标签
writeFileSync(src + '/page.html', '<html><body><h1>FAQ</h1><p>怎么绑定？发 #绑定</p><script>var x=1</script></body></html>');
const htmlr = await K.importKbFromPath(src + '/page.html');
const htmlText = htmlr.ok ? K.readKbFile('page.md').text : '';
T("HTML 去标签导入", htmlr.ok && htmlText.includes("怎么绑定") && !htmlText.includes("var x"), { htmlr, htmlText });
// docx：手搓一个最小 docx（zip + document.xml）
import('node:zlib');
const JSZipLite = { };
// 用 node 内置能力造 zip 较麻烦，改用 WSL 的 python 生成
const { execFileSync } = await import('node:child_process');
let docxMade = false;
try {
  execFileSync('wsl', ['-d','Ubuntu','-e','python3','-c', 'import zipfile;' + 'p="/mnt/c/Users/Ranmi/AppData/Local/Temp/dsh-test-kbimp/import-src/doc.docx";' + 'z=zipfile.ZipFile(p,"w");' + 'z.writestr("[Content_Types].xml","<Types/>");' + 'z.writestr("word/document.xml","<w:document><w:body><w:p><w:r><w:t>这是文档内容</w:t></w:r></w:p></w:body></w:document>");' + 'z.close()'], { stdio: 'ignore' }); docxMade = true } catch (e) {}
if (docxMade) {
  const dr = await K.importKbFromPath(src + '/doc.docx');
  const dtext = dr.ok ? K.readKbFile('doc.md').text : '';
  T("DOCX 提取正文", dr.ok && dtext.includes("这是文档内容"), { dr, dtext });
} else { T("DOCX 提取正文（跳过：WSL 不可用）", true) }
// sqlite：用 WSL python 建库再导入
let dbMade = false;
try {
  execFileSync('wsl', ['-d','Ubuntu','-e','python3','-c', 'import sqlite3;' + 'p="/mnt/c/Users/Ranmi/AppData/Local/Temp/dsh-test-kbimp/import-src/faq.db";' + 'c=sqlite3.connect(p);' + 'c.execute("create table faq(q text, a text)");' + 'c.execute("insert into faq values(?,?)",("怎么进群","找管理员"));' + 'c.commit();c.close()'], { stdio: 'ignore' }); dbMade = true } catch (e) {}
if (dbMade) {
  const sr = await K.importKbFromPath(src + '/faq.db');
  const stext = sr.ok ? K.readKbFile('faq.md').text : '';
  T("SQLite 表转成文本", sr.ok && stext.includes("怎么进群") && stext.includes("faq"), { sr, stext });
} else { T("SQLite 表转成文本（跳过：WSL 不可用）", true) }
console.log("=== 知识库导入 测试 ===");
let fail = 0;
for (const [n, pass, e] of ok) { console.log((pass ? "OK  " : "FAIL ") + n + (pass ? "" : "   " + JSON.stringify(e || {}).slice(0, 160))); if (!pass) fail++; }
console.log(fail ? ("失败 " + fail) : ("全部通过 " + ok.length + "/" + ok.length));
process.exit(fail ? 1 : 0);
