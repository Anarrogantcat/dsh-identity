process.env.DSH_HOME = 'C:/Users/Ranmi/AppData/Local/Temp/dsh-test-media';
import { mkdirSync, rmSync } from "node:fs";
try { rmSync(process.env.DSH_HOME, { recursive: true, force: true }) } catch {}
mkdirSync(process.env.DSH_HOME + "/profiles/desktop", { recursive: true });
const base = "file:///C:/Users/Ranmi/.dsh/profiles/desktop/node_modules/dsh-qqbot-refine/";
const T = await import(base + "lib/toolgate.js");
const { ensureDirs } = await import(base + "lib/store.js");
const { loadConfig, saveConfig, clone, DEFAULTS } = await import(base + "lib/config.js");
import { homedir } from "node:os";
import { join } from "node:path";
ensureDirs();
const cfg = clone(DEFAULTS);
cfg.tools.allowForMembers = ["web_search", "read_image", "qqbot_describe_image"];
saveConfig(cfg);
const ok = [];
const mediaPath = join(homedir(), ".dsh-qqbot", "media", "shot_2026.png");
ok.push(["qqbot 媒体目录算工作区内（看图不再被拒）", T.outsidePath({ path: mediaPath }, loadConfig()) === null, T.outsidePath({ path: mediaPath }, loadConfig())]);
ok.push(["媒体目录在 workspaceRoots 里", T.workspaceRoots(loadConfig()).some(r => r.includes(".dsh-qqbot"))]);
const bad = "C:\\Windows\\System32\\drivers\\etc\\hosts";
ok.push(["系统目录仍然被拒", T.outsidePath({ path: bad }, loadConfig()) === bad, T.outsidePath({ path: bad }, loadConfig())]);
const dshPath = join(homedir(), ".dsh", "profiles", "desktop", "cordis.patch.yml");
ok.push([".dsh 真配置仍然被拒", String(T.outsidePath({ path: dshPath }, loadConfig())) .length > 0, String(T.outsidePath({ path: dshPath }, loadConfig()))]);
ok.push(["图片工具已在成员白名单", loadConfig().tools.allowForMembers.includes("read_image") && loadConfig().tools.allowForMembers.includes("qqbot_describe_image")]);
console.log("=== 看图工具闸门 测试 ===");
let fail = 0;
for (const [n, pass, extra] of ok) { console.log((pass ? "OK  " : "FAIL ") + n + (pass ? "" : "   " + JSON.stringify(extra))); if (!pass) fail++ }
console.log(fail ? ("失败 " + fail) : "全部通过");
process.exit(fail ? 1 : 0);
