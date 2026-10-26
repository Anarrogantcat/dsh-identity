process.env.DSH_HOME = 'C:/Users/Ranmi/AppData/Local/Temp/dsh-test-dlp';
import { mkdirSync, rmSync, writeFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
const HOME = process.env.DSH_HOME;
try { rmSync(HOME, { recursive: true, force: true }) } catch {}
mkdirSync(HOME + "/profiles/desktop", { recursive: true });
const base = "file:///C:/Users/Ranmi/.dsh/profiles/desktop/node_modules/dsh-qqbot-refine/";
const D = await import(base + "lib/downloads.js");
const { ensureDirs, dirs } = await import(base + 'lib/store.js');
ensureDirs();
// 1MB 的测试文件，分块慢发
const SIZE = 1024 * 1024;
const server = createServer(async (req, res) => {
  res.writeHead(200, { "content-type": "application/octet-stream", "content-length": String(SIZE) });
  const chunk = Buffer.alloc(64 * 1024, 7);
  for (let i = 0; i < SIZE / chunk.length; i++) { res.write(chunk); await new Promise((r) => setTimeout(r, 30)) }
  res.end();
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = 'http://127.0.0.1:' + server.address().port + '/f.bin';
const seen = [];
const dest = dirs.downloads + '/prog-test.bin';
const r = await D.downloadUrl(url, dest, { onProgress: (p) => seen.push(p) });
const ok = []; const T = (n, c, e) => ok.push([n, !!c, e]);
T("下载成功", r.ok === true, r);
T("文件大小正确", r.bytes === SIZE, r.bytes);
T("进度回调被调用多次", seen.length >= 2, seen.length);
T("进度单调不减", seen.every((x, i) => i === 0 || x.got >= seen[i - 1].got), seen.map((x) => x.got));
T("最终知道总大小", seen[seen.length - 1].total === SIZE, seen[seen.length - 1]);
T("有速度估算", Number(seen[seen.length - 1].speedBps) > 0, seen[seen.length - 1]);
server.close();
console.log("=== 下载进度 测试 ===");
let fail = 0;
for (const [n, pass, e] of ok) { console.log((pass ? "OK  " : "FAIL ") + n + (pass ? "" : "   " + JSON.stringify(e))); if (!pass) fail++; }
console.log(fail ? ("失败 " + fail) : ("全部通过 " + ok.length + "/" + ok.length));
process.exit(fail ? 1 : 0);
