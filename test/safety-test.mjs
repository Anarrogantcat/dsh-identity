import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
process.env.DSH_HOME = 'C:/Users/Ranmi/AppData/Local/Temp/dsh-test-safety';

import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
const HOME = process.env.DSH_HOME;
try { rmSync(HOME, { recursive: true, force: true }) } catch {}
mkdirSync(HOME + "/profiles/desktop", { recursive: true });

const base = new URL('../', import.meta.url).href;
const S = await import(base + "lib/safety.js");
const { ensureDirs, readJson } = await import(base + "lib/store.js");
ensureDirs();

const ok = [];
const add = (name, pass, extra) => ok.push([name, pass, extra]);
const SAFETY_FILE = S.SAFETY_PATH;

// ── 档位 ──
const safe = S.SAFETY_PROFILES.safe;
add("safe 档：30/150/8/false/false/10",
  safe.perHour === 30 && safe.perDay === 150 && safe.gapSec === 8 && safe.proactive === false && safe.dmStranger === false && safe.imagesPerDay === 10,
  safe);
const normal = S.SAFETY_PROFILES.normal;
add("normal 档：60/600/2/true/true/30",
  normal.perHour === 60 && normal.perDay === 600 && normal.gapSec === 2 && normal.proactive === true && normal.dmStranger === true && normal.imagesPerDay === 30,
  normal);
add("没有 safety 配置 → 默认 normal", (() => { const l = S.safetyLimits({}); return l.profile === 'normal' && l.perHour === 60 && l.proactive === true; })(), S.safetyLimits({}));
add("safe 档生效", (() => { const l = S.safetyLimits({ safety: { profile: 'safe' } }); return l.perHour === 30 && l.gapSec === 8 && l.proactive === false && l.imagesPerDay === 10; })(), S.safetyLimits({ safety: { profile: 'safe' } }));
add("未知档位回落 normal", (() => { const l = S.safetyLimits({ safety: { profile: 'paranoid' } }); return l.profile === 'normal' && l.perHour === 60; })(), S.safetyLimits({ safety: { profile: 'paranoid' } }));
add("safetyLimits 返回副本（改它不污染常量）", (() => {
  const l = S.safetyLimits({ safety: { profile: 'safe' } });
  l.perHour = 999; l.really = true;
  return S.SAFETY_PROFILES.safe.perHour === 30 && S.SAFETY_PROFILES.safe.really === undefined;
})(), S.SAFETY_PROFILES.safe);
add("熔断常量：3 次 / 30 分钟", S.MAX_CONSECUTIVE_FAILS === 3 && S.BREAKER_MS === 30 * 60 * 1000, { f: S.MAX_CONSECUTIVE_FAILS, ms: S.BREAKER_MS });

// ── 熔断 ──
S.resetBreaker();
const t0 = Date.now();
const f1 = S.noteSendResult(false, {});
const f2 = S.noteSendResult(false, {});
const f3 = S.noteSendResult(false, {});
add("失败 1 次不熔断", f1.tripped === false && f1.fails === 1, f1);
add("失败 2 次不熔断", f2.tripped === false && f2.fails === 2, f2);
add("连续 3 次失败 → 熔断", f3.tripped === true && f3.fails === 3, f3);
add("熔断 30 分钟（until ≈ now+30min）", Math.abs(f3.until - (t0 + 30 * 60 * 1000)) < 5000, { until: f3.until, want: t0 + 1800000 });
add("熔断后 breakerOpen=true", S.breakerOpen() === true);
const st = S.breakerState();
add("breakerState 形状 {open,until,fails,reason}", st.open === true && st.fails === 3 && st.until > Date.now() && typeof st.reason === "string" && st.reason.length > 0, st);
add("熔断期内再失败不续期也不重复触发", (() => {
  const before = S.breakerState().until;
  const r = S.noteSendResult(false, {});
  const after = S.breakerState().until;
  return r.tripped === false && r.fails === 4 && after === before;
})(), S.breakerState());
add("成功清零连续失败计数", (() => {
  S.resetBreaker();
  S.noteSendResult(false, {});
  S.noteSendResult(false, {});
  const succ = S.noteSendResult(true, {});
  const a = S.noteSendResult(false, {});
  const b = S.noteSendResult(false, {});
  return succ.fails === 0 && succ.tripped === false && a.fails === 1 && b.fails === 2 && b.tripped === false;
})(), S.breakerState());

// 过期自动关闭（直接改盘上的 until）
writeFileSync(SAFETY_FILE, JSON.stringify({ breaker: { until: Date.now() - 1000, fails: 3, reason: "旧熔断" }, banned: {} }), "utf8");
add("过期的熔断自动关闭", S.breakerOpen() === false);
add("过期关闭会落盘（until 归零）", (() => {
  const j = readJson(SAFETY_FILE, null);
  return j?.breaker?.until === 0 && j?.breaker?.fails === 0;
})(), readJson(SAFETY_FILE, null));
add("把时间往后拨 31 分钟也算过期", (() => {
  S.resetBreaker();
  S.tripBreaker("测试");
  return S.breakerState(Date.now() + 31 * 60 * 1000).open === false;
})(), {});
add("tripBreaker 手动熔断带原因", (() => {
  S.resetBreaker();
  const r = S.tripBreaker("Owner 踩刹车");
  return r.open === true && r.reason === "Owner 踩刹车" && r.until > Date.now();
})(), S.breakerState());
add("resetBreaker 清空", (() => {
  S.resetBreaker();
  const r = S.breakerState();
  return r.open === false && r.fails === 0 && r.until === 0 && r.reason === "";
})(), S.breakerState());

// ── 被踢 / 被禁言 ──
add("记录被踢", (() => {
  const r = S.noteKicked("690618714", "被管理员踢出");
  return r.ok === true && r.groupId === "690618714" && r.at > 0 && r.reason === "被管理员踢出";
})(), S.noteKicked("690618714", "被管理员踢出"));
add("isBannedGroup 查得到", S.isBannedGroup("690618714") === true);
add("bannedGroups 列表带原因和时间", (() => {
  const list = S.bannedGroups();
  return list.length === 1 && list[0].groupId === "690618714" && list[0].reason === "被管理员踢出" && list[0].at > 0;
})(), S.bannedGroups());
add("落盘能回读", (() => {
  const j = readJson(SAFETY_FILE, null);
  return j?.banned?.["690618714"]?.reason === "被管理员踢出" && j.banned["690618714"].at > 0;
})(), readJson(SAFETY_FILE, null));
add("空 groupId 不记、不误判", S.isBannedGroup("") === false && S.isBannedGroup(null) === false && S.noteKicked("").ok === false);
add("解除被踢记录", (() => {
  const r = S.unbanGroup("690618714");
  return r.ok === true && r.removed === true && S.isBannedGroup("690618714") === false && S.bannedGroups().length === 0;
})(), S.bannedGroups());
add("解除不存在的群也不炸", S.unbanGroup("no-such-group").removed === false);
add("安全模块不碰 config（settings.json 不存在）", existsSync(HOME + "/storages/dsh-qqbot-refine/settings.json") === false);

// ── 脏数据 ──
writeFileSync(SAFETY_FILE, "{{{ 坏掉的 json", "utf8");
add("坏文件 → 空状态、不抛", (() => {
  try {
    return S.breakerState().open === false && S.bannedGroups().length === 0 && S.isBannedGroup("x") === false;
  } catch { return false; }
})(), {});
writeFileSync(SAFETY_FILE, JSON.stringify({ breaker: "nope", banned: [1, 2, 3] }), "utf8");
add("结构不对 → 空状态、不抛", (() => {
  try { return S.breakerOpen() === false && S.bannedGroups().length === 0; } catch { return false; }
})(), {});

console.log("=== 安全档位 / 熔断 / 被踢 测试 ===");
let fail = 0;
for (const [n, pass, extra] of ok) { console.log((pass ? "OK  " : "FAIL ") + n + (pass ? "" : "   " + JSON.stringify(extra))); if (!pass) fail++ }
console.log(fail ? ("失败 " + fail) : ("全部通过 " + (ok.length - fail) + "/" + ok.length));
process.exit(fail ? 1 : 0);
