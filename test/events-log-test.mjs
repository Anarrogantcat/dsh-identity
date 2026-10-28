process.env.DSH_HOME = 'C:/Users/Ranmi/AppData/Local/Temp/dsh-dev-events';
import { rmSync, mkdirSync, writeFileSync } from 'node:fs';
const HOME = process.env.DSH_HOME;
try { rmSync(HOME, { recursive: true, force: true }) } catch {}
mkdirSync(HOME + '/profiles/desktop', { recursive: true });
const base = new URL('../lib/', import.meta.url);
const { ensureDirs, dirs } = await import(new URL('store.js', base));
ensureDirs();
const E = await import(new URL('events.js', base));
const ok = []; const A = (n, c, e) => ok.push([n, !!c, e]);

const PK = 'g_test';
A('合法事件追加成功', E.appendEvent(PK, { kind: 'talk', origin: 'inbound', who: 'A', text: '  今天  天气 不错 ' }).ok === true);
const r2 = E.appendEvent(PK, { kind: 'talk', origin: 'inbound', text: '第二句' });
A('seq 递增', r2.seq === 2, r2);
A('非法 kind 被拒', E.appendEvent(PK, { kind: 'nonsense', origin: 'inbound' }).ok === false);
A('非法 origin 被拒', E.appendEvent(PK, { kind: 'talk', origin: 'model' }).ok === false);

const dup = E.appendEvent(PK, { kind: 'talk', origin: 'inbound', ref: 'msg_1', text: '有 ref 的' });
const dup2 = E.appendEvent(PK, { kind: 'talk', origin: 'inbound', ref: 'msg_1', text: '重复投递' });
A('同一 ref 只记一次', dup.ok && dup2.ok && dup2.dup === true && dup2.seq === dup.seq, { dup, dup2 });

const list = E.readEvents(PK);
A('读取按 seq 升序', list.every((x, i) => i === 0 || x.seq > list[i - 1].seq), list.map((x) => x.seq));
A('文本被压缩空白且截断', list[0].text === '今天 天气 不错', list[0].text);
A('lastSeq 正确', E.lastSeq(PK) === list[list.length - 1].seq);

// 修剪：造一个很旧的日期文件
const oldDate = '2020-01-01';
E.appendEvent(PK, { kind: 'talk', origin: 'inbound', text: '旧事件', at: oldDate + 'T10:00:00+08:00' });
A('旧日期文件存在', E.listDays(PK).includes(oldDate), E.listDays(PK));
const removed = E.pruneEvents(30, new Date());
A('修剪掉旧文件', removed >= 1 && !E.listDays(PK).includes(oldDate), { removed, days: E.listDays(PK) });

// bot 来源合法（由调度器禁止，不由事件流禁止）
A('bot 来源可记录', E.appendEvent(PK, { kind: 'talk', origin: 'bot', who: 'self' }).ok === true);

console.log('=== 事件流（append-only / 幂等 / 修剪）测试 ===');
let fail = 0;
for (const [n, p, e] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(e ?? null).slice(0, 160))); if (!p) fail++; }
console.log(fail ? ('失败 ' + fail) : ('全部通过 ' + ok.length + '/' + ok.length));
await new Promise((r) => setTimeout(r, 100));
process.exitCode = fail ? 1 : 0;
