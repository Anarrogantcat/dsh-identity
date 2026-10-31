process.env.DSH_HOME = process.env.DSH_HOME || 'C:/dsh-test-temp/dsh-dev-sched';
import { rmSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const HOME = process.env.DSH_HOME;
try { rmSync(HOME, { recursive: true, force: true }) } catch {}
mkdirSync(HOME + '/profiles/desktop', { recursive: true });
const base = new URL('../lib/', import.meta.url);
const { ensureDirs } = await import(new URL('store.js', base));
ensureDirs();
const S = await import(new URL('scheduler.js', base));
const ok = []; const A = (n, c, e) => ok.push([n, !!c, e]);
const STATE = HOME + '/storages/dsh-qqbot-refine/scheduler.json';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1) 正常跑 + 幂等
let runs = 0;
const r1 = await S.runTask({ key: 'diary:g1', kind: 'diary', origin: 'timer' }, async () => { runs++; return 'done' });
A('第一次跑成功', r1.ran === true && r1.result === 'done' && runs === 1, r1);
const r2 = await S.runTask({ key: 'diary:g1', kind: 'diary', origin: 'timer' }, async () => { runs++; return 'again' });
A('同一天同 runKey 幂等跳过', r2.ran === false && r2.skipped && /幂等/.test(r2.reason) && runs === 1, r2);

// 2) 来源闸：bot 不许触发
const r3 = await S.runTask({ key: 'diary:g2', kind: 'diary', origin: 'bot' }, async () => 'bad');
A('bot 来源被拒', r3.ran === false && /bot/.test(r3.reason), r3);

// 3) 失败退避 + 熔断
let n = 0;
const t0 = Date.now();
const failTask = (now) => S.runTask({ key: 'reflect:g1', kind: 'reflect', origin: 'timer', now }, async () => { n++; throw new Error('boom') });
const f1 = await failTask(t0);
A('失败被记录', f1.ran === true && /boom/.test(f1.error), f1);
const f2 = await failTask(t0 + 61 * 1000);
const f3 = await failTask(t0 + 61 * 1000 + 121 * 1000);
A('三次失败后进入禁用', f3.ran === true && n === 3, { n, f3 });
const after = await S.runTask({ key: 'reflect:g1', kind: 'reflect', origin: 'timer', now: t0 + 61 * 1000 + 122 * 1000 }, async () => { n++; return 'x' });
A('禁用后不再跑（不重试成死循环）', after.ran === false && /禁用/.test(after.reason) && n === 3, after);

// 4) 租约：模拟正在跑
const st = JSON.parse(readFileSync(STATE, 'utf8'));
st.tasks['stuck'] = { leaseUntil: Date.now() + 60000, running: true };
writeFileSync(STATE, JSON.stringify(st));
const r4 = await S.runTask({ key: 'stuck', kind: 'diary', origin: 'timer' }, async () => 'nope');
A('租约未过期：跳过', r4.ran === false && /正在运行/.test(r4.reason), r4);

// 5) 预算闸
const r5 = await S.runTask({ key: 'diary:g3', kind: 'diary', origin: 'timer', budgetCheck: () => ({ allow: false, reason: '没有额度' }) }, async () => 'x');
A('预算不足：跳过并给原因', r5.ran === false && /没有额度/.test(r5.reason), r5);
const r6 = await S.runTask({ key: 'diary:g4', kind: 'diary', origin: 'timer', budgetCheck: () => ({ allow: true, degrade: true, reason: '降级' }) }, async () => 'x');
A('预算降级：不跑，交给降级路径', r6.ran === false && r6.degrade === true, r6);

// 6) 全局单并发
const order = [];
const p1 = S.runTask({ key: 'c1', kind: 'x', origin: 'timer' }, async () => { order.push('a1'); await sleep(30); order.push('a2') });
const p2 = S.runTask({ key: 'c2', kind: 'x', origin: 'timer' }, async () => { order.push('b1') });
await Promise.all([p1, p2]);
A('两个任务串行执行（不并发）', order.join(',') === 'a1,a2,b1', order);

// 7) 超时
const r7 = await S.runTask({ key: 'slow', kind: 'x', origin: 'timer', timeoutMs: 40 }, () => new Promise(() => {}));
A('超时被强杀并记失败', r7.ran === true && /超时/.test(r7.error), r7);

console.log('=== 调度器（幂等/来源/退避/租约/预算/并发/超时）测试 ===');
let fail = 0;
for (const [label, p, e] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + label + (p ? '' : '   ' + JSON.stringify(e ?? null).slice(0, 160))); if (!p) fail++; }
console.log(fail ? ('失败 ' + fail) : ('全部通过 ' + ok.length + '/' + ok.length));
await new Promise((r) => setTimeout(r, 100));
process.exitCode = fail ? 1 : 0;
