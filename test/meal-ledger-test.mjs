process.env.DSH_HOME = 'C:/Users/Ranmi/AppData/Local/Temp/dsh-test-mealledger';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
const HOME = process.env.DSH_HOME;
try { rmSync(HOME, { recursive: true, force: true }) } catch {}
mkdirSync(HOME + '/profiles/desktop', { recursive: true });
writeFileSync(HOME + '/profiles/desktop/cordis.patch.yml', "- id: im-qqbot\n  config:\n    appId: '1905982004'\n    appSecret: dummy\n", 'utf8');
const { pathToFileURL } = await import('node:url');
const { homedir } = await import('node:os');
const { join } = await import('node:path');
const base = pathToFileURL(join(homedir(), '.dsh', 'profiles', 'desktop', 'node_modules', 'dsh-qqbot-refine')).href + '/';
const { ensureDirs } = await import(base + 'lib/store.js');
ensureDirs();
const M = await import(base + 'lib/meal.js');
const { clone, DEFAULTS } = await import(base + 'lib/config.js');
const ok = []; const A = (n, c, e) => ok.push([n, !!c, e]);

const cfg = clone(DEFAULTS);
cfg.usage.groupDailyYuan = 3; cfg.usage.mealPrice = 0.01;
cfg.usage.rechargeMaxOnce = 20; cfg.usage.rechargeDailyCap = 50; cfg.usage.rechargeUserDailyCap = 0;

// ── 流水：记谁充了、时间、金额 ──
const r1 = M.recharge(cfg, 'u1', 5, '小明');
A('充值成功', r1.ok === true, r1);
A('文案里有合计与上限', /今天合计已充/.test(r1.message) && /上限/.test(r1.message), r1.message);
const led = M.mealLedger(5);
A('流水有一笔', led.length === 1, led);
A('流水带名字和金额', led[0].who === '小明' && Number(led[0].amount) === 5 && !!led[0].t, led[0]);

// ── 防手滑：同一人 60 秒内报同一笔金额 ──
const r2 = M.recharge(cfg, 'u1', 5, '小明');
A('重复金额被挡住', r2.ok === false && /刚才已经记过/.test(r2.message), r2);
const r3 = M.recharge(cfg, 'u1', 6, '小明');
A('换个金额可以继续充', r3.ok === true, r3);

// ── 每人每日上限 ──
const cfgCap = clone(cfg);
cfgCap.usage.rechargeUserDailyCap = 4;
const r4 = M.recharge(cfgCap, 'u2', 4, '小红');
A('刚好到每人上限可以', r4.ok === true, r4);
const r5 = M.recharge(cfgCap, 'u2', 1, '小红');
A('超过每人上限被拒（文案带还能再充）', r5.ok === false && /每人今天最多/.test(r5.message), r5.message);
A('别人不受这条限制', M.recharge(cfgCap, 'u3', 4, '小刚').ok === true);

// ── 每人上限 = 0 表示不限 ──
const cfgNo = clone(cfg);
cfgNo.usage.rechargeUserDailyCap = 0;
A('0 = 不限', M.recharge(cfgNo, 'u4', 10, '大款').ok === true && M.recharge(cfgNo, 'u4', 11, '大款').ok === true);

// ── 汇总：谁添过饭 ──
const sum = M.mealSummary(cfg);
A('汇总有总额', /今天收了/.test(sum), sum);
A('汇总带人名', /小明|小红|小刚|大款/.test(sum), sum);
A('汇总有最近几笔', /最近/.test(sum), sum);

console.log('=== 充饭钱（流水 / 每人上限 / 防重）测试 ===');
let fail = 0;
for (const [n, pass, e] of ok) { console.log((pass ? 'OK  ' : 'FAIL ') + n + (pass ? '' : '   ' + JSON.stringify(e ?? null).slice(0, 160))); if (!pass) fail++; }
console.log(fail ? ('失败 ' + fail) : ('全部通过 ' + ok.length + '/' + ok.length));
await new Promise((r) => setTimeout(r, 150));
process.exitCode = fail ? 1 : 0;
