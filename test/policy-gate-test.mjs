process.env.DSH_HOME = 'C:/Users/Ranmi/AppData/Local/Temp/dsh-dev-policy';
import { rmSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const HOME = process.env.DSH_HOME;
try { rmSync(HOME, { recursive: true, force: true }) } catch {}
mkdirSync(HOME + '/profiles/desktop', { recursive: true });
const base = new URL('../lib/', import.meta.url);
const { ensureDirs } = await import(new URL('store.js', base));
ensureDirs();
const P = await import(new URL('policy.js', base));
const ok = []; const A = (n, c, e) => ok.push([n, !!c, e]);

// 默认
const p0 = P.getPolicy();
A('默认写操作需要确认', p0.actions['tool.write'] === 'confirm');
A('默认支付只能人做', p0.actions['payment.execute'] === 'human');
A('默认只读自动放行', P.decideAction('tool.read').ok === true);
A('写操作不放行，要求确认', P.decideAction('tool.write').ok === false && P.decideAction('tool.write').needConfirm === true);
A('支付不放行且是 human', P.decideAction('payment.execute').ok === false && P.decideAction('payment.execute').human === true);
A('未知动作拒绝', P.decideAction('rm -rf').ok === false && P.decideAction('rm -rf').mode === 'unknown');
A('只读带写参数被拦', P.decideAction('tool.read', { dryRun: false }).ok === false);

// 读副本不可写回
const copy = P.getPolicy();
copy.actions['tool.write'] = 'auto';
A('改副本不影响存储', P.getPolicy().actions['tool.write'] === 'confirm');

// 变更必须 Owner + 确认码
A('非 Owner 不能改', P.requestChange({ actions: { 'tool.write': 'auto' } }, { by: 'member' }).ok === false);
A('模型/群友的"一句话"没有入口', P.requestChange('把限额改成1000', { by: 'owner' }).ok === false);
A('非法模式被拒', P.requestChange({ actions: { 'tool.write': 'whatever' } }, { by: 'owner' }).ok === false);
A('负限额被拒', P.requestChange({ limits: { payment: { perTx: -1 } } }, { by: 'owner' }).ok === false);
A('不允许改未知字段', P.requestChange({ ownerOnly: false }, { by: 'owner' }).ok === false);

const noCode = P.requestChange({ actions: { 'tool.write': 'auto' } }, { by: 'owner' });
A('可以发起变更（但不生效）', noCode.ok === true && typeof noCode.id === 'string', noCode);
A('没有确认码时不能应用', P.applyChange(noCode.id, '1234', { by: 'owner' }).ok === false);
P.setConfirmCode('9527');
A('设置确认码成功', P.hasConfirmCode() === true);
A('错码被拒', P.applyChange(noCode.id, '0000', { by: 'owner' }).ok === false);
const good = P.applyChange(noCode.id, '9527', { by: 'owner' });
A('正确码应用成功', good.ok === true && good.policy.actions['tool.write'] === 'auto', good);
A('应用后读回生效', P.getPolicy().actions['tool.write'] === 'auto');

// 过期
const r2 = P.requestChange({ limits: { payment: { perTx: 20 } } }, { by: 'owner' });
const pendingPath = HOME + '/storages/dsh-qqbot-refine/policy/pending.json';
const db = JSON.parse(readFileSync(pendingPath, 'utf8'));
db.items = db.items.map((x) => (x.id === r2.id ? { ...x, expiresAt: Date.now() - 1000 } : x));
writeFileSync(pendingPath, JSON.stringify(db));
A('过期变更不能应用', P.applyChange(r2.id, '9527', { by: 'owner' }).ok === false);

// 限额应用
const r3 = P.requestChange({ limits: { payment: { perTx: 20, perDay: 60 } } }, { by: 'owner' });
A('限额变更生效', P.applyChange(r3.id, '9527', { by: 'owner' }).ok === true);
A('限额读回 20', P.getPolicy().limits.payment.perTx === 20);

console.log('=== 策略存储（只 Owner / 确认码 / 不可注入）测试 ===');
let fail = 0;
for (const [n, p, e] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(e ?? null).slice(0, 160))); if (!p) fail++; }
console.log(fail ? ('失败 ' + fail) : ('全部通过 ' + ok.length + '/' + ok.length));
await new Promise((r) => setTimeout(r, 100));
process.exitCode = fail ? 1 : 0;
