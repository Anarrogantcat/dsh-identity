process.env.DSH_HOME = process.env.DSH_HOME || 'C:/dsh-test-temp/dsh-dev-gateway';
import { rmSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const HOME = process.env.DSH_HOME;
try { rmSync(HOME, { recursive: true, force: true }) } catch {}
mkdirSync(HOME + '/profiles/desktop', { recursive: true });
const base = new URL('../lib/', import.meta.url);
const { ensureDirs } = await import(new URL('store.js', base));
ensureDirs();
const P = await import(new URL('policy.js', base));
const G = await import(new URL('gateway.js', base));
const ok = []; const A = (n, c, e) => ok.push([n, !!c, e]);
const wallet = { mode: 'spend-authorized', balance: 100 };

P.setConfirmCode('9527');

// 1) 单笔上限（默认 10）
A('5 元申请成功', G.createRequest({ amount: 5, payee: 'alice', orderId: 'o1', wallet }).ok === true);
const over = G.createRequest({ amount: 20, payee: 'alice', orderId: 'o2', wallet });
A('超单笔上限被拒', over.ok === false && /单笔上限/.test(over.error), over);
A('金额非法被拒', G.createRequest({ amount: -1, payee: 'alice', orderId: 'o3', wallet }).ok === false);
A('缺少订单号被拒', G.createRequest({ amount: 1, payee: 'alice', orderId: '', wallet }).ok === false);

// 2) 幂等：同一 orderId
const again = G.createRequest({ amount: 5, payee: 'alice', orderId: 'o1', wallet });
A('同一订单重复申请返回原单', again.ok === true && again.dup === true, again);

// 3) 确认码
const req = G.createRequest({ amount: 5, payee: 'alice', orderId: 'o10', wallet });
A('申请只生成待确认单', req.ok === true && !!req.requestId);
const bad = G.confirmRequest(req.requestId, '0000', { by: 'owner' });
A('错确认码被拒', bad.ok === false && /确认码/.test(bad.error), bad);
const notOwner = G.confirmRequest(req.requestId, '9527', { by: 'member' });
A('非 Owner 不能确认', notOwner.ok === false, notOwner);
const good = G.confirmRequest(req.requestId, '9527', { by: 'owner' });
A('确认码正确才执行', good.ok === true && good.receipt.amount === 5, good);
const replay = G.confirmRequest(req.requestId, '9527', { by: 'owner' });
A('重放被拒', replay.ok === false && /已经执行/.test(replay.error), replay);
const dupOrder = G.createRequest({ amount: 5, payee: 'alice', orderId: 'o10', wallet });
A('已执行订单不能重新申请', dupOrder.ok === false && dupOrder.executed === true, dupOrder);

// 4) 钱包：冻结 / 未授权 / 余额不足
A('冻结钱包被拒', G.createRequest({ amount: 1, payee: 'alice', orderId: 'w1', wallet: { mode: 'spend-authorized', frozen: true } }).ok === false);
A('未授权支出被拒', G.createRequest({ amount: 1, payee: 'alice', orderId: 'w2', wallet: { mode: 'observe' } }).ok === false);
A('余额不足被拒', G.createRequest({ amount: 5, payee: 'alice', orderId: 'w3', wallet: { mode: 'spend-authorized', balance: 1 } }).ok === false);

// 5) 限额变更：单笔 100、日 12、白名单 alice
const ch = P.requestChange({ limits: { payment: { perTx: 100, perDay: 12, allowPayees: ['alice'] } } }, { by: 'owner' });
A('限额变更应用', P.applyChange(ch.id, '9527', { by: 'owner' }).ok === true);
const noPayee = G.createRequest({ amount: 1, payee: 'bob', orderId: 'p1', wallet });
A('收款方不在白名单被拒', noPayee.ok === false && /白名单/.test(noPayee.error), noPayee);

// 已执行 5；再执行 5 → 日累计 10；再申请 5（10+5>12）被拒
const r2 = G.createRequest({ amount: 5, payee: 'alice', orderId: 'o20', wallet });
const c2 = G.confirmRequest(r2.requestId, '9527', { by: 'owner' });
A('第二笔执行成功', c2.ok === true, c2);
const r3 = G.createRequest({ amount: 5, payee: 'alice', orderId: 'o30', wallet });
A('日额度不足被拒', r3.ok === false && /今日额度/.test(r3.error), r3);

// 6) 过期
const r4 = G.createRequest({ amount: 1, payee: 'alice', orderId: 'o40', wallet });
const reqPath = HOME + '/storages/dsh-qqbot-refine/wallet/requests.json';
const db = JSON.parse(readFileSync(reqPath, 'utf8'));
db.items = db.items.map((x) => (x.id === r4.requestId ? { ...x, expiresAt: Date.now() - 1000 } : x));
writeFileSync(reqPath, JSON.stringify(db));
A('过期单不能确认', G.confirmRequest(r4.requestId, '9527', { by: 'owner' }).ok === false);

// 7) 台账
const sum = G.paymentSummary();
A('台账汇总今日 10', sum.day === 10, sum);
A('待确认单计数正确', sum.pending >= 1, sum);

console.log('=== 支付网关（限额/白名单/确认码/幂等/过期/台账）测试 ===');
let fail = 0;
for (const [n, p, e] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(e ?? null).slice(0, 160))); if (!p) fail++; }
console.log(fail ? ('失败 ' + fail) : ('全部通过 ' + ok.length + '/' + ok.length));
await new Promise((r) => setTimeout(r, 100));
process.exitCode = fail ? 1 : 0;
