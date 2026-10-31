import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
process.env.DSH_HOME = process.env.DSH_HOME || 'C:/dsh-test-temp/dsh-test-dl';
import { mkdirSync, rmSync, writeFileSync, existsSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
const HOME = process.env.DSH_HOME;
try { rmSync(HOME, { recursive: true, force: true }) } catch {}
mkdirSync(HOME + "/profiles/desktop", { recursive: true });
writeFileSync(HOME + "/profiles/desktop/cordis.patch.yml", "- id: im-qqbot\n  config:\n    appId: '1905982004'\n    appSecret: dummy\n", "utf8");

const DEF = join(HOME, "storages", "dsh-qqbot-refine");
const ALT = join(HOME, "alt-data");
mkdirSync(DEF, { recursive: true });
writeFileSync(join(DEF, ".data-path"), ALT, "utf8");
const cfgUrl = new URL("../lib/config.js", import.meta.url).href;
const probe = join(HOME, "probe.mjs");
writeFileSync(probe, [
  'import { STORE_DIR, dataPointer, DEFAULT_STORE_DIR } from ' + JSON.stringify(cfgUrl) + ';',
  'console.log(JSON.stringify({ store: STORE_DIR, ptr: dataPointer(), def: DEFAULT_STORE_DIR }))'
].join(String.fromCharCode(10)), "utf8");
const out = execFileSync(process.execPath, [probe], { encoding: "utf8", env: { ...process.env, DSH_HOME: HOME } }).trim();
const pj = JSON.parse(out.split("\n").pop());

const ok = [];
const T = (n, c, e) => ok.push([n, !!c, e]);
T("指针文件生效（STORE_DIR 指向新盘）", pj.store.toLowerCase() === ALT.toLowerCase(), pj);
T("dataPointer() 读到指针", pj.ptr.toLowerCase() === ALT.toLowerCase(), pj.ptr);
T("默认目录仍是 C 盘那个", pj.def.toLowerCase() === DEF.toLowerCase(), pj.def);

const out2 = execFileSync(process.execPath, [probe], { encoding: "utf8", env: { ...process.env, DSH_HOME: HOME, QQBOT_REFINE_HOME: join(HOME, "env-data") } }).trim();
const pj2 = JSON.parse(out2.split("\n").pop());
T("环境变量 QQBOT_REFINE_HOME 优先", pj2.store.toLowerCase() === join(HOME, "env-data").toLowerCase(), pj2.store);

const base = new URL('../', import.meta.url).href;
const D = await import(base + "lib/downloads.js");
const { loadConfig, saveConfig, clone, DEFAULTS } = await import(base + "lib/config.js");
const { ensureDirs, dirs } = await import(base + "lib/store.js");
ensureDirs();
saveConfig(clone(DEFAULTS));
let st = D.assetStatus(loadConfig());
T("清单有 whisper small/base + ffmpeg", st.items.length === 3 && st.items.some((i) => i.id === "whisper-model-small") && st.items.some((i) => i.id === "ffmpeg-essentials"), st.items.map((i) => i.id));
T("默认下载目录在 <store>/downloads", st.root.toLowerCase() === dirs.downloads.toLowerCase(), st.root);
T("一开始都没装", st.items.every((i) => !i.installed), st.items.map((i) => i.installed));

const c2 = clone(DEFAULTS);
c2.paths.downloadsDir = join(HOME, "bigdisk", "qqbot-assets");
saveConfig(c2);
st = D.assetStatus(loadConfig());
T("paths.downloadsDir 生效", st.root.toLowerCase() === join(HOME, "bigdisk", "qqbot-assets").toLowerCase(), st.root);
saveConfig(clone(DEFAULTS));

const payload = Buffer.alloc(2048, 7);
const server = createServer((req, res) => {
  if (req.url === "/ok.bin") { res.writeHead(200, { "content-type": "application/octet-stream" }); res.end(payload) }
  else if (req.url === "/fail") { res.writeHead(500); res.end("nope") }
  else { res.writeHead(404); res.end() }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const dest = join(HOME, "dl", "ok.bin");
const d1 = await D.downloadUrl("http://127.0.0.1:" + port + "/ok.bin", dest);
T("downloadUrl 成功落盘", d1.ok && existsSync(dest) && statSync(dest).size === payload.length, d1);
T("不留 .part 半截文件", !existsSync(dest + ".part"), existsSync(dest + ".part"));
T("内容正确", readFileSync(dest).length === payload.length, readFileSync(dest).length);
const d2 = await D.downloadUrl("http://127.0.0.1:" + port + "/fail", join(HOME, "dl", "bad.bin"));
T("HTTP 500 判失败", d2.ok === false && /HTTP 500/.test(d2.error), d2);
T("失败不留文件", !existsSync(join(HOME, "dl", "bad.bin")), true);
const d3 = await D.downloadUrl("ftp://x/y", join(HOME, "dl", "no.bin"));
T("非 http(s) 直接拒", d3.ok === false && /http/.test(d3.error), d3);
server.close();

const modelFile = join(D.downloadsDir(loadConfig()), "ggml-base.bin");
mkdirSync(D.downloadsDir(loadConfig()), { recursive: true });
writeFileSync(modelFile, Buffer.alloc(1024));
st = D.assetStatus(loadConfig());
const baseItem = st.items.find((i) => i.id === "whisper-model-base");
T("装了之后状态变已下载", baseItem.installed && baseItem.bytes === 1024, baseItem);
T("体积明显小于标称 → 标「可能不完整」", baseItem.looksComplete === false, baseItem.looksComplete);
const auto = D.sttAutoCommand(loadConfig());
T("有模型就拼出 stt 命令", /whisper-cli/.test(auto) && auto.includes("ggml-base.bin") && auto.includes("{file}"), auto);
const rm = D.removeAsset("whisper-model-base", loadConfig());
T("removeAsset 删得掉", rm.ok && !existsSync(modelFile), rm);
T("删完自动命令为空", D.sttAutoCommand(loadConfig()) === "", D.sttAutoCommand(loadConfig()));

const stats = D.downloadsStats();
T("downloadsStats 结构完整", typeof stats.root === "string" && stats.total === 3 && typeof stats.installed === "number", stats);

console.log("=== 语音资源下载 / 数据挪盘 测试 ===");
let fail = 0;
for (const [n, pass, e] of ok) { console.log((pass ? "OK  " : "FAIL ") + n + (pass ? "" : "   " + JSON.stringify(e))); if (!pass) fail++ }
console.log(fail ? ("失败 " + fail + "/" + ok.length) : ("全部通过 " + ok.length + "/" + ok.length));
process.exit(fail ? 1 : 0);
