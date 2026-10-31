import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
process.env.DSH_HOME = process.env.DSH_HOME || 'C:/dsh-test-temp/dsh-test-llmroute';
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
const HOME = process.env.DSH_HOME;
try { rmSync(HOME, { recursive: true, force: true }) } catch {}
mkdirSync(HOME + "/profiles/desktop", { recursive: true });
writeFileSync(HOME + "/profiles/desktop/cordis.patch.yml", "- id: im-qqbot\n  config:\n    appId: '1905982004'\n    appSecret: dummy\n", "utf8");
const base = new URL('../', import.meta.url).href;
const L = await import(base + "lib/llmroute.js");

const ok = [];
const T = (n, c, e) => ok.push([n, !!c, e]);
const svc = { currentSelection: () => ({ provider: "deepseek-account", model: "deepseek-flash" }) };
const broken = { currentSelection: () => { throw new Error("boom") } };

T("配置齐了就听配置", L.resolveRoute(svc, "my-prov", "my-model").source === "config", L.resolveRoute(svc, "my-prov", "my-model"));
T("配置空就用宿主默认", (() => { const r = L.resolveRoute(svc, "", ""); return r.source === "host-default" && r.provider === "deepseek-account" && r.model === "deepseek-flash" })(), L.resolveRoute(svc, "", ""));
T("只填一半也算没填（回落默认）", L.resolveRoute(svc, "only-provider", "").source === "host-default", L.resolveRoute(svc, "only-provider", ""));
T("没有服务 → none 且不抛", (() => { const r = L.resolveRoute(null, "", ""); return r.source === "none" && r.provider === "" })(), L.resolveRoute(null, "", ""));
T("服务抛错 → none", L.resolveRoute(broken, "", "").source === "none", L.resolveRoute(broken, "", ""));

const cfg = { profile: { llmProvider: "", llmModel: "", enabled: true }, integration: { llmProvider: "", llmModel: "" } };
const route = L.resolveRoute(svc, "", "");
const patched = L.withRoute(cfg, "profile", route);
T("withRoute 填进副本", patched.profile.llmProvider === "deepseek-account" && patched.profile.llmModel === "deepseek-flash", patched.profile);
T("withRoute 不动原对象", cfg.profile.llmProvider === "", cfg.profile);
T("withRoute 保留其它字段", patched.profile.enabled === true, patched.profile);
const cfg2 = { profile: { llmProvider: "x", llmModel: "y" } };
T("已显式配置就不覆盖", L.withRoute(cfg2, "profile", route) === cfg2, true);
T("route 无效时原样返回", L.withRoute(cfg, "profile", { provider: "", model: "", source: "none" }) === cfg, true);

console.log("=== 模型路由（留空=宿主默认）测试 ===");
let fail = 0;
for (const [n, pass, e] of ok) { console.log((pass ? "OK  " : "FAIL ") + n + (pass ? "" : "   " + JSON.stringify(e))); if (!pass) fail++ }
console.log(fail ? ("失败 " + fail + "/" + ok.length) : ("全部通过 " + ok.length + "/" + ok.length));
process.exit(fail ? 1 : 0);
