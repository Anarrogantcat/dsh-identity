process.env.DSH_HOME = process.env.DSH_HOME || 'C:/dsh-test-temp/dsh-dev-budget';
import { rmSync, mkdirSync, unlinkSync } from 'node:fs';
const HOME = process.env.DSH_HOME;
try { rmSync(HOME, { recursive: true, force: true }) } catch {}
mkdirSync(HOME + '/profiles/desktop', { recursive: true });
const base = new URL('../lib/', import.meta.url);
const { ensureDirs } = await import(new URL('store.js', base));
ensureDirs();
const B = await import(new URL('budget.js', base));
const ok = []; const A = (n, c, e) => ok.push([n, !!c, e]);
const resetState = () => { try { unlinkSync(HOME + '/storages/dsh-qqbot-refine/budget.json') } catch {} };

// soft：按比例
const a1 = B.computeAllowance({ mode: 'soft', sharePercent: 15, floorTokens: 800 }, { spentTodayTokens: 10000 });
A('soft：10000 × 15% = 1500', a1.allowanceTokens === 1500, a1);
const a2 = B.computeAllowance({ mode: 'soft', sharePercent: 15, floorTokens: 800 }, { spentTodayTokens: 0 });
A('没花钱也有保底 800', a2.allowanceTokens === 800, a2);
const a3 = B.computeAllowance({ mode: 'soft', sharePercent: 15, floorTokens: 800, ceilingTokens: 1000 }, { spentTodayTokens: 100000 });
A('可选硬顶生效 1000', a3.allowanceTokens === 1000, a3);
A('默认不锁死（没上限）', B.normalizeBudget({}).ceilingTokens === null);
const a4 = B.computeAllowance({ mode: 'hard', ceilingTokens: 5000, floorTokens: 800 }, { spentTodayTokens: 0 });
A('hard + 显式上限 = 5000', a4.allowanceTokens === 5000, a4);
const a5 = B.computeAllowance({ mode: 'hard', ceilingTokens: null, sharePercent: 10 }, { spentTodayTokens: 20000 });
A('hard 但没上限 → 退回比例 2000', a5.allowanceTokens === 2000, a5);
A('off = 0', B.computeAllowance({ mode: 'off' }, {}).allowanceTokens === 0);

// 预估 EMA
resetState();
A('没数据时用兜底 1200', B.estimateTokens('diary') === 1200);
B.recordUsage('diary', 2000);
A('第一次真实值直接成为估计', B.estimateTokens('diary') === 2000);
B.recordUsage('diary', 1000);
const est = B.estimateTokens('diary');
A('EMA 向新值靠拢但保留惯性', est > 1000 && est < 2000, est);
A('调用计数累加', B.loadBudgetState().calls === 2);

// 决策
resetState();
const d1 = B.decideCall({ mode: 'soft', sharePercent: 15, floorTokens: 800 }, { kind: 'diary', estimate: 100, spentTodayTokens: 0 });
A('额度够：允许', d1.allow === true && d1.degrade === false, d1);
const d2 = B.decideCall({ mode: 'soft', sharePercent: 15, floorTokens: 800 }, { kind: 'diary', estimate: 700, spentTodayTokens: 0 });
A('预估超过额度 40%：降级而不是取消', d2.allow === true && d2.degrade === true, d2);
const d3 = B.decideCall({ mode: 'off' }, { kind: 'diary', estimate: 100 });
A('off：拒绝', d3.allow === false, d3);
const d4 = B.decideCall({ mode: 'soft' }, { kind: 'diary', estimate: 100, hardStopped: true });
A('全局硬闸触发：拒绝', d4.allow === false && /硬闸/.test(d4.reason), d4);

resetState();
B.recordUsage('diary', 1000);
const d5 = B.decideCall({ mode: 'soft', maxCallsPerDay: 1 }, { kind: 'diary', estimate: 100 });
A('每日次数上限生效', d5.allow === false && /上限/.test(d5.reason), d5);

console.log('=== 自适应预算（比例/保底/上限/降级）测试 ===');
let fail = 0;
for (const [n, p, e] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(e ?? null).slice(0, 160))); if (!p) fail++; }
console.log(fail ? ('失败 ' + fail) : ('全部通过 ' + ok.length + '/' + ok.length));
await new Promise((r) => setTimeout(r, 100));
process.exitCode = fail ? 1 : 0;
