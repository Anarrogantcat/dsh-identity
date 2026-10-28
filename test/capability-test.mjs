import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
process.env.DSH_HOME = 'C:/Users/Ranmi/AppData/Local/Temp/dsh-test-cap';
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
const HOME = process.env.DSH_HOME;
try { rmSync(HOME, { recursive: true, force: true }) } catch {}
mkdirSync(HOME + "/profiles/desktop", { recursive: true });
writeFileSync(HOME + "/profiles/desktop/cordis.patch.yml", "- id: im-qqbot\n  config:\n    appId: '1905982004'\n    appSecret: dummy-secret-for-test\n", "utf8");
const base = new URL('../', import.meta.url).href;
const C = await import(base + "lib/capabilities.js");
const R = await import(base + "lib/roster.js");
const { loadConfig, saveConfig, clone, DEFAULTS } = await import(base + "lib/config.js");
const { ensureDirs } = await import(base + "lib/store.js");
ensureDirs();
const ok = [];
const A = (n, c, e) => ok.push([n, !!c, e]);
// 默认 tencent
const c1 = clone(DEFAULTS); saveConfig(c1);
const caps1 = C.capabilitySummary(loadConfig());
A("默认模式 tencent", caps1.mode === "tencent", caps1.mode);
A("tencent 缺群名片/成员列表/撤回/戳/转发/表情/引用/视频/STT/名册",
  ["groupCard","memberList","recallEvent","pokeEvent","mergedForwardIn","reactionEvent","quoteOut","videoOut","stt","roster"].every(k => caps1.missing.includes(k)),
  caps1.missing);
A("tencent 有语音/文件/群管/真实用量", ["voiceOut","fileOut","groupAdmin","realUsage"].every(k => caps1.available.includes(k)), caps1.available);
// onebot
const c2 = clone(DEFAULTS); c2.transport.mode = "onebot"; saveConfig(c2);
const caps2 = C.capabilitySummary(loadConfig());
A("onebot 全能力 15/15", caps2.available.length === caps2.total, caps2);
A("has() 按模式判定", C.has("groupCard") === true && C.has("nonexistent") === false, [C.has("groupCard"), C.has("nonexistent")]);
// guardCap 跳过（切回 tencent 再测）
const c2b = clone(DEFAULTS); c2b.transport.mode = "tencent"; saveConfig(c2b);
const skipped = C.guardCap("groupCard", () => "ran")();
A("缺能力时 guardCap 跳过", skipped.skipped === true && /groupCard/.test(skipped.reason), skipped);
// roster：官方模式不支持
const c3 = clone(DEFAULTS); saveConfig(c3);
const fake = { call: async () => { throw new Error("should not be called") } };
const r1 = await R.refreshAll(fake, loadConfig());
A("官方模式名册跳过", r1.ok === false && /不支持/.test(r1.error), r1);
// roster：onebot 模式拉取
const c4 = clone(DEFAULTS); c4.transport.mode = "onebot"; saveConfig(c4);
const client = { call: async (action) => {
  if (action === "get_group_list") return [{ group_id: 123456789, group_name: "测试群", member_count: 42, max_member_count: 200 }];
  if (action === "get_friend_list") return [{ user_id: 10001, nickname: "染喵", remark: "主人" }];
  if (action === "get_group_member_list") return [{ user_id: 10001, card: "染喵本喵", nickname: "染喵", role: "owner" }];
  return null;
} };
const r2 = await R.refreshAll(client, loadConfig());
A("onebot 群/好友拉取成功", r2.ok === true && r2.groups === 1 && r2.friends === 1, r2);
A("群名可查", R.groupName(123456789) === "测试群", R.groupName(123456789));
A("好友名可查", R.friendName(10001) === "主人", R.friendName(10001));
const r3 = await R.refreshMembers(client, 123456789, loadConfig());
A("成员拉取成功", r3.ok === true && r3.count === 1, r3);
A("群名片优先", R.memberCard(123456789, 10001) === "染喵本喵", R.memberCard(123456789, 10001));
const roles = R.rolesOf(123456789);
A("角色聚合正确", roles.owners.includes(10001), roles);
const st = R.rosterStats();
A("统计可用", st.groups === 1 && st.friends === 1 && st.members === 1 && st.supported === true, st);
console.log("=== 能力位 / 名册 测试 ===");
let fail = 0;
for (const [n, pass, e] of ok) { console.log((pass ? "OK  " : "FAIL ") + n + (pass ? "" : "   " + JSON.stringify(e))); if (!pass) fail++ }
console.log(fail ? ("失败 " + fail) : "全部通过");
process.exit(fail ? 1 : 0);
