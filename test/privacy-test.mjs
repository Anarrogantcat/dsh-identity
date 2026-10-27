import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
process.env.DSH_HOME = 'C:/Users/Ranmi/AppData/Local/Temp/dsh-test-home' // __TEST_HOME__ 隔离，绝不写真实配置
const base = pathToFileURL(join(homedir(), '.dsh', 'profiles', 'desktop', 'node_modules', 'dsh-qqbot-refine', 'lib/')).href;
const P = await import(base + "privacy.js");
const { loadConfig } = await import(base + "config.js");
const ok = [];
const cfg = loadConfig();

const r1 = P.redactText("手机 13812345678 身份证 110101199003071234 卡 6222021234567890123", cfg);
ok.push(["手机号", r1.includes("[手机号]") && !r1.includes("13812345678")]);
ok.push(["身份证", r1.includes("[身份证]")]);
ok.push(["银行卡", r1.includes("[卡号]")]);
const r2 = P.redactText("我的 key 是 sk-abcdefghijklmnop1234，路径 C:\\Users\\Ranmi\\.dsh\\x", cfg);
ok.push(["密钥", r2.includes("[密钥已隐藏]") && !r2.includes("sk-")]);
ok.push(["路径", r2.includes("[本机路径]")]);

const cfg2 = JSON.parse(JSON.stringify(cfg));
cfg2.privacy.redactKeywords = ["染喵"];
ok.push(["自定义脱敏", P.redactText("我是染喵", cfg2).includes("[已隐藏]")]);

const cfg3 = JSON.parse(JSON.stringify(cfg));
cfg3.privacy.blockBuiltin = true;
ok.push(["内置拦截：member", P.shouldDrop("你的身份证号是多少", cfg3, "member").drop === true]);
ok.push(["内置拦截：owner 豁免", P.shouldDrop("你的身份证号是多少", cfg3, "owner").drop === false]);
ok.push(["内置拦截关闭时不丢", P.shouldDrop("你的身份证号是多少", cfg, "member").drop === false]);
cfg3.privacy.blockKeywords = ["广告"];
ok.push(["自定义丢弃生效", P.shouldDrop("这是广告", cfg3, "member").drop === true]);

ok.push(["记忆入库脱敏", P.redactForMemory("电话 13812345678", cfg).includes("[手机号]")]);

console.log("=== 隐私规则测试 ==="); let fail = 0;
for (const [n, p] of ok) { console.log(`${p ? "✅" : "❌"} ${n}`); if (!p) fail++ }
console.log(fail ? `失败 ${fail}` : "全部通过");

