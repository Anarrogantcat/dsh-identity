process.env.DSH_HOME = 'C:/Users/Ranmi/AppData/Local/Temp/dsh-dev-lifecycle';
import { rmSync, mkdirSync } from 'node:fs';
const HOME = process.env.DSH_HOME;
try { rmSync(HOME, { recursive: true, force: true }) } catch {}
mkdirSync(HOME + '/profiles/desktop', { recursive: true });
const base = new URL('../lib/', import.meta.url);
const { ensureDirs } = await import(new URL('store.js', base));
ensureDirs();
const L = await import(new URL('lifecycle.js', base));
const ok = []; const A = (n, c, e) => ok.push([n, !!c, e]);
const DAY = 86400000;
const now = Date.now();
const at = (d) => new Date(now - d * DAY).toISOString();

// 1) 初始
const t0 = L.makeTrait({ kind: 'preference', text: '喜欢短句' });
A('新认知默认 tentative', t0.status === 'tentative' && t0.hits === 0, t0);

// 2) 单次证据：仍 tentative
let t = L.addEvidence(t0, { kind: 'self-say', ref: 'm1', at: at(0) }, now);
A('一次证据不升 durable', t.status === 'tentative', t);
A('置信度随证据上升但不高', t.confidence > 0.3 && t.confidence < 0.6, t.confidence);

// 3) 同一天三次：不够（没有跨天）
let same = L.makeTrait({ text: '同一天三次' });
for (const i of [0, 1, 2]) same = L.addEvidence(same, { kind: 'self-say', ref: 's' + i, at: at(0) }, now);
A('同一天 3 次仍不 durable（防止一天情绪定型）', same.status === 'tentative', same.status);

// 4) 跨天三次：durable
let cross = L.makeTrait({ text: '跨天三次' });
for (const d of [3, 2, 1]) cross = L.addEvidence(cross, { kind: 'correction', ref: 'c' + d, at: at(d) }, now);
A('跨 3 天 3 次 → durable', cross.status === 'durable', { status: cross.status, hits: cross.hits });
A('durable 置信度更高', cross.confidence >= 0.6, cross.confidence);

// 5) 情绪单独多次：永不 durable
let mood = L.makeTrait({ text: '只是情绪' });
for (const d of [4, 2, 1]) mood = L.addEvidence(mood, { kind: 'feeling', ref: 'f' + d, at: at(d) }, now);
A('情绪事件再多也不直接成 durable', mood.status === 'tentative', mood.status);

// 6) 冻结检测：伪造一条 durable，没有足够证据 → 降回 tentative
const fake = { ...t0, status: 'durable', evidence: [{ at: at(0), kind: 'feeling' }] };
A('冻结检测把假 durable 降级', L.freezeGuard(fake, now).status === 'tentative');

// 7) 过期
const old = { ...t0, status: 'tentative', lastConfirmed: at(120) };
A('tentative 90 天过期 → retired', L.expireTentative(old, now, 90).status === 'retired');
const fresh = { ...t0, status: 'tentative', lastConfirmed: at(10) };
A('新鲜 tentative 不过期', L.expireTentative(fresh, now, 90).status === 'tentative');

// 8) 去重
let dd = L.makeTrait({ text: '去重' });
dd = L.addEvidence(dd, { kind: 'self-say', ref: 'x' }, now);
dd = L.addEvidence(dd, { kind: 'self-say', ref: 'x' }, now);
A('同 ref 不重复计数', dd.hits === 1, dd.hits);

// 9) 冲突 / Owner 否决
const [a, b] = L.markConflict({ ...t0, status: 'durable', confidence: 0.8 }, { ...t0, text: '相反', status: 'durable', confidence: 0.7 });
A('冲突双方降 tentative 并标记', a.status === 'tentative' && b.status === 'tentative' && a.conflict && b.conflict);
A('Owner 否决 → retired', L.retire(a, 'owner', now).status === 'retired');

console.log('=== 状态分层（tentative/durable/冻结/过期）测试 ===');
let fail = 0;
for (const [n, p, e] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(e ?? null).slice(0, 160))); if (!p) fail++; }
console.log(fail ? ('失败 ' + fail) : ('全部通过 ' + ok.length + '/' + ok.length));
await new Promise((r) => setTimeout(r, 100));
process.exitCode = fail ? 1 : 0;
