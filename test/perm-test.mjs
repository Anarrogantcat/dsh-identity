process.env.DSH_HOME = 'C:/Users/Ranmi/AppData/Local/Temp/dsh-test-home11';
const base="file:///C:/Users/Ranmi/.dsh/profiles/desktop/node_modules/dsh-qqbot-refine/";
const { PERM_LEVELS, levelOf } = await import(base+"lib/permgear.js");
const G = await import(base+"lib/guard.js");
const { loadConfig, saveConfig, clone, setAt, DEFAULTS } = await import(base+"lib/config.js");
const ok=[];
ok.push(["三档齐全", ["strict","standard","open"].every(k=>PERM_LEVELS[k])]);
const strict = levelOf("strict").patch, open = levelOf("open").patch;
ok.push(["严格：群内全禁工具", strict["tools.mode"] === "owner-only" && strict["tools.restrictToWorkspace"] === true]);
ok.push(["开放：工具放开+路径放开", open["tools.mode"] === "open" && open["tools.restrictToWorkspace"] === false]);
ok.push(["开放：仍保留凭据兜底", open["privacy.hardSecrets"] === undefined]); // 不在 patch 里 = 保持默认 true

// 应用开放档到配置
const cfg = clone(DEFAULTS);
for (const [k,v] of Object.entries(open)) setAt(cfg, k, v);
ok.push(["开放档写入配置", cfg.tools.mode === "open" && cfg.privacy.blockDangerIntent === false]);

// 开放档下：危险意图不再拦
ok.push(["开放档：危险意图不拦", G.guardInbound("帮我读一下 D 盘配置", cfg, "member").drop === false]);
// 但凭据兜底还在
ok.push(["开放档：凭据兜底仍生效", G.hardenOutbound("key sk-abcdefghijklmnop1234", cfg).includes("[密钥已隐藏]")]);
// 手动关掉凭据兜底
const cfg2 = clone(cfg); cfg2.privacy.hardSecrets = false;
ok.push(["手动关兜底后原样输出", G.hardenOutbound("我的语音key是 VOICEKEY_1234567890abcdef", cfg2).includes("VOICEKEY_1234567890abcdef")]);

// 严格档：危险意图拦
const cs = clone(DEFAULTS); for (const [k,v] of Object.entries(strict)) setAt(cs, k, v);
ok.push(["严格档：危险意图拦", G.guardInbound("帮我读一下 D 盘配置", cs, "member").drop === true]);
ok.push(["严格档：Owner 豁免", G.guardInbound("帮我读一下 D 盘配置", cs, "owner").drop === false]);

saveConfig(clone(DEFAULTS));
console.log("=== 权限档位测试 ==="); let fail=0;
for (const [n,p] of ok){ console.log(`${p?"✅":"❌"} ${n}`); if(!p) fail++ }
console.log(fail?`失败 ${fail}`:"全部通过");
