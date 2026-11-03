import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
process.env.DSH_HOME = process.env.TEMP.replace(/\\/g, '/') + '/dsh-test-home7';
const base = new URL('../lib/', import.meta.url).href;
const G = await import(base+"guard.js");
const os = await import("node:os");
const cfg = { voice: { apiKey: "TEST_FAKE_VOICE_KEY_01" }, sticker: { genProvider: { apiKey: "TEST_FAKE_IMAGE_KEY_01" } }, bili: { cookie: "SESSDATA=TEST_FAKE_SESS_01; bili_jct=x" } };
const ok=[];
const out = G.hardenOutbound("我的语音key是 TEST_FAKE_VOICE_KEY_01 图像key TEST_FAKE_IMAGE_KEY_01", cfg);
ok.push(["语音 apiKey 原文隐藏", !out.includes("TEST_FAKE_VOICE_KEY_01") && out.includes("[凭据已隐藏]")]);
ok.push(["图像 apiKey 原文隐藏", !out.includes("TEST_FAKE_IMAGE_KEY_01")]);
const out2 = G.hardenOutbound("SESSDATA 是 TEST_FAKE_SESS_01", cfg);
ok.push(["B站 SESSDATA 隐藏", !out2.includes("TEST_FAKE_SESS_01")]);
const u = os.userInfo().username;
const out3 = G.hardenOutbound("我的用户名是 " + u, cfg);
ok.push(["本机用户名隐藏", u.length < 3 || !out3.includes(u + " ")]);
ok.push(["正常文本不受影响", G.hardenOutbound("今天吃白饭", cfg) === "今天吃白饭"]);
console.log("=== 真实凭据兜底测试 ==="); let fail=0;
for(const [n,p] of ok){ console.log(`${p?"✅":"❌"} ${n}`); if(!p) fail++ }
console.log(fail?`失败 ${fail}`:"全部通过");

// 断言失败要真的算失败（run-all 只看 exit code）
process.exitCode = fail ? 1 : 0;

