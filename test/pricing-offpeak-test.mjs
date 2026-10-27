process.env.DSH_HOME = 'C:/Users/Ranmi/AppData/Local/Temp/dsh-test-pricing';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
const HOME = process.env.DSH_HOME;
try { rmSync(HOME, { recursive: true, force: true }) } catch {}
mkdirSync(HOME + '/profiles/desktop', { recursive: true });
writeFileSync(HOME + '/profiles/desktop/cordis.patch.yml', "- id: im-qqbot\n  config:\n    appId: '1905982004'\n    appSecret: dummy\n", 'utf8');
const { pathToFileURL } = await import('node:url');
const { homedir } = await import('node:os');
const { join } = await import('node:path');
const base = pathToFileURL(join(homedir(), '.dsh', 'profiles', 'desktop', 'node_modules', 'dsh-qqbot-refine')).href + '/';
const { ensureDirs, dirs } = await import(base + 'lib/store.js');
ensureDirs();
const U = await import(base + 'lib/usage.js');
const { clone, DEFAULTS } = await import(base + 'lib/config.js');
const ok = []; const A = (n, c, e) => ok.push([n, !!c, e]);

// ── 1. 默认值必须和 usage.js 的 DEFAULT_PRICES 一致（以前 0.2 / 3 是旧价）──
A('配置默认命中价 = usage 默认', Number(DEFAULTS.usage.priceInputHit) === Number(U.DEFAULT_PRICES.inputHit), [DEFAULTS.usage.priceInputHit, U.DEFAULT_PRICES.inputHit]);
A('配置默认输出价 = usage 默认', Number(DEFAULTS.usage.priceOutput) === Number(U.DEFAULT_PRICES.output), [DEFAULTS.usage.priceOutput, U.DEFAULT_PRICES.output]);
A('配置默认未命中价 = usage 默认', Number(DEFAULTS.usage.priceInputMiss) === Number(U.DEFAULT_PRICES.inputMiss), [DEFAULTS.usage.priceInputMiss, U.DEFAULT_PRICES.inputMiss]);

// ── 2. 空闲价：没填就按系数折算，填了就按填的 ──
const cfg = clone(DEFAULTS);
const off0 = U.offPeakPricesOf(cfg);
A('默认空闲价 = 峰价 × 0.5（未命中）', Math.abs(off0.inputMiss - 1) < 1e-9, off0);
A('默认空闲价 = 峰价 × 0.5（命中）', Math.abs(off0.inputHit - 0.02) < 1e-9, off0);
A('默认空闲价 = 峰价 × 0.5（输出）', Math.abs(off0.output - 4) < 1e-9, off0);

cfg.usage.priceOffPeakInputMiss = 1.1;
cfg.usage.priceOffPeakInputHit = 0.03;
cfg.usage.priceOffPeakOutput = 4.4;
const off1 = U.offPeakPricesOf(cfg);
A('显式空闲价优先生效', off1.inputMiss === 1.1 && off1.inputHit === 0.03 && off1.output === 4.4, off1);

cfg.usage.priceOffPeakFactor = 0.25;
const cfg2 = clone(DEFAULTS); cfg2.usage.priceOffPeakFactor = 0.25;
A('系数可调（0.25）', Math.abs(U.offPeakPricesOf(cfg2).inputMiss - 0.5) < 1e-9, U.offPeakPricesOf(cfg2));

// ── 3. 峰谷分桶按两套价算钱 ──
const c3 = clone(DEFAULTS);
c3.usage.calibFactor = 1;
c3.usage.searchFreeUntil = '2099-01-01T00:00:00+08:00';
writeFileSync(join(dirs.root, 'usage-buckets.json'), JSON.stringify({
  date: new Date().toISOString().slice(0, 10),
  buckets: { peak: { input: 1e6, hit: 1e6, output: 1e6 }, offpeak: { input: 1e6, hit: 1e6, output: 1e6 } },
  search: 0,
}), 'utf8');
const rep = U.bucketsReport(c3);
const wantPeak = 2 + 0.04 + 8;
const wantOff = 1 + 0.02 + 4;
A('高峰金额 = 2 + 0.04 + 8', Math.abs(rep.peakCost - wantPeak) < 1e-6, rep.peakCost);
A('空闲金额 = 1 + 0.02 + 4', Math.abs(rep.offpeakCost - wantOff) < 1e-6, rep.offpeakCost);
A('总额 = 峰 + 谷', Math.abs(rep.total - (wantPeak + wantOff)) < 1e-6, rep.total);
A('回报里带两套单价', !!rep.offPeakPrices && rep.offPeakPrices.inputMiss === 1, rep.offPeakPrices);

// 显式空闲价也进账
const c4 = clone(c3);
c4.usage.priceOffPeakInputMiss = 3;
c4.usage.priceOffPeakInputHit = 0;
c4.usage.priceOffPeakOutput = 0;
const rep4 = U.bucketsReport(c4);
A('显式空闲价参与结算', Math.abs(rep4.offpeakCost - (3 + 0.02 + 4)) < 1e-6, rep4.offpeakCost);

// ── 4. 峰谷判定：工作日 / 周末 / 节假日 / 周末开关 ──
const c5 = clone(DEFAULTS);
c5.usage.holidays = [];
const wed10 = Date.UTC(2026, 9, 28, 2, 0, 0); // 周三 10:00 北京
A('工作日 10:00 算高峰', U.bucketNow(c5, wed10) === 'peak', U.bucketNow(c5, wed10));
A('工作日 13:00 算空闲', U.bucketNow(c5, Date.UTC(2026, 9, 28, 5, 0, 0)) === 'offpeak');
const sat10 = Date.UTC(2026, 9, 31, 2, 0, 0); // 周六 10:00
A('周末算空闲', U.bucketNow(c5, sat10) === 'offpeak', U.bucketNow(c5, sat10));
const c6 = clone(DEFAULTS); c6.usage.peakOnlyWeekdays = false;
A('关掉周末开关后周六仍按时段判定', U.bucketNow(c6, sat10) === 'peak');
const c7 = clone(DEFAULTS); c7.usage.holidays = ['2026-10-28'];
A('节假日整天算空闲（可以在面板配）', U.bucketNow(c7, wed10) === 'offpeak');
const c8 = clone(DEFAULTS); c8.usage.peakWindows = ['08:00-12:00', '13:00-18:00'];
A('高峰时段可自定义', U.bucketNow(c8, Date.UTC(2026, 9, 28, 5, 0, 0)) === 'peak');

console.log('=== 峰谷计价（两套价）测试 ===');
let fail = 0;
for (const [n, pass, e] of ok) { console.log((pass ? 'OK  ' : 'FAIL ') + n + (pass ? '' : '   ' + JSON.stringify(e ?? null).slice(0, 160))); if (!pass) fail++; }
console.log(fail ? ('失败 ' + fail) : ('全部通过 ' + ok.length + '/' + ok.length));
await new Promise((r) => setTimeout(r, 150));
process.exitCode = fail ? 1 : 0;
