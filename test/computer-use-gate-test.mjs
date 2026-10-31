process.env.DSH_HOME = process.env.DSH_HOME || 'C:/dsh-test-temp/dsh-test-cugate';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
const HOME = process.env.DSH_HOME;
try { rmSync(HOME, { recursive: true, force: true }) } catch {}
mkdirSync(HOME + '/profiles/desktop', { recursive: true });
writeFileSync(HOME + '/profiles/desktop/cordis.patch.yml', "- id: im-qqbot\n  config:\n    appId: '1905982004'\n    appSecret: dummy\n", 'utf8');
const { pathToFileURL } = await import('node:url');
const { homedir } = await import('node:os');
const { join } = await import('node:path');
const base = new URL('../', import.meta.url).href;
const { ensureDirs, peerKey } = await import(base + 'lib/store.js');
ensureDirs();
const T = await import(base + 'lib/toolgate.js');
const { clone, DEFAULTS, loadConfig, saveConfig } = await import(base + 'lib/config.js');
const persona = await import(base + 'lib/persona.js');
const S = await import(base + 'lib/state.js');
const ok = []; const A = (n, c, e) => ok.push([n, !!c, e]);

const cfg = clone(DEFAULTS);
cfg.scope.groups = ['G1'];
cfg.tools.enableGate = true;
cfg.tools.ownerFullAccess = true;
cfg.tools.allowForMembers = ['web_search', 'todo_write'];
saveConfig(cfg);
Object.assign(S.state, { counters: {} });

const sid = await persona.sessionIdFor('1905982004', 'group', 'G1');
persona.rememberSession(sid, peerKey('group', 'G1'), 'group', 'G1');
const exec = { agent: { session: { id: sid } } };
const tool = (name) => ({ name });
const now = () => loadConfig();

// ── 名称归一：MCP 前缀要认 ──
A('mcp__wincu__xxx → 短名', T.bareToolName('mcp__wincu__windows_computer_use_click') === 'windows_computer_use_click', T.bareToolName('mcp__wincu__windows_computer_use_click'));
A('普通工具名不变', T.bareToolName('web_search') === 'web_search');

// ── computerUse = off：群成员一律不许 ──
const cOff = clone(cfg); cOff.tools.computerUse = 'off'; saveConfig(cOff);
const a1 = T.decide(tool('mcp__wincu__windows_computer_use_screenshot'), {}, exec, now());
A('off：截图被拒', a1.allow === false && a1.why === 'computer-use-off', a1);
const a2 = T.decide(tool('windows_computer_use_click'), {}, exec, now());
A('off：点击被拒', a2.allow === false, a2);

// ── computerUse = read：只看不动 ──
const cRead = clone(cfg); cRead.tools.computerUse = 'read'; saveConfig(cRead);
const b1 = T.decide(tool('mcp__wincu__windows_computer_use_screenshot'), {}, exec, now());
A('read：截图放行', b1.allow === true && b1.why === 'computer-use:read', b1);
const b2 = T.decide(tool('windows_computer_use_list_windows'), {}, exec, now());
A('read：列窗口放行', b2.allow === true, b2);
const b3 = T.decide(tool('windows_computer_use_accessibility_tree'), {}, exec, now());
A('read：读控件树放行', b3.allow === true, b3);
const b4 = T.decide(tool('mcp__wincu__windows_computer_use_click'), { x: 10, y: 10 }, exec, now());
A('read：点击被拒', b4.allow === false && b4.why === 'computer-use-readonly', b4);
const b5 = T.decide(tool('windows_computer_use_type_text'), { text: 'hi' }, exec, now());
A('read：打字被拒', b5.allow === false, b5);
const b6 = T.decide(tool('windows_computer_use_keypress'), { keys: ['ENTER'] }, exec, now());
A('read：按键被拒', b6.allow === false, b6);

// ── computerUse = full：能点能打字（危险命令仍然拦）──
const cFull = clone(cfg); cFull.tools.computerUse = 'full'; saveConfig(cFull);
const d1 = T.decide(tool('windows_computer_use_click'), { x: 10, y: 10 }, exec, now());
A('full：点击放行', d1.allow === true && d1.why === 'computer-use:full', d1);
const d2 = T.decide(tool('windows_computer_use_type_text'), { text: 'hi' }, exec, now());
A('full：打字放行', d2.allow === true, d2);
const d3 = T.decide(tool('windows_computer_use_set_value'), { elementId: 'abc', value: 'x' }, exec, now());
A('full：设值放行', d3.allow === true, d3);

// ── Owner 不受 computerUse 限制（ownerFullAccess 默认开）──
const cOff2 = clone(cfg); cOff2.tools.computerUse = 'off'; saveConfig(cOff2);
T.setTurnRole(sid, 'owner');
const e1 = T.decide(tool('windows_computer_use_click'), { x: 1, y: 1 }, exec, now());
A('Owner 即使 off 也能点（ownerFullAccess）', e1.allow === true && e1.why === 'owner-full', e1);

// ── 危险命令：Owner 也不许 ──
const e2 = T.decide(tool('pwsh'), { command: 'format c:' }, exec, now());
A('Owner 也不能跑危险命令', e2.allow === false && e2.why === 'danger', e2);

// ── 白名单：短名 / 通配 ──
T.setTurnRole(sid, 'member');
const f1 = clone(cfg); f1.tools.computerUse = 'read'; f1.tools.allowForMembers = ['web_*']; saveConfig(f1);
const g1 = T.decide(tool('web_search'), { query: 'x' }, exec, now());
A('白名单支持 web_* 通配', g1.allow === true, g1);
const g2 = T.decide(tool('todo_write'), { todos: [] }, exec, now());
A('没命中的工具仍被拒', g2.allow === false && g2.why === 'not-allowed', g2);

const f2 = clone(cfg); f2.tools.computerUse = 'read'; f2.tools.allowForMembers = ['windows_computer_use_health']; saveConfig(f2);
const h1 = T.decide(tool('mcp__wincu__windows_computer_use_health'), {}, exec, now());
A('白名单短名能对上 MCP 全名', h1.allow === true, h1);

// ── 非 QQ 会话完全不受影响 ──
const i1 = T.decide(tool('windows_computer_use_click'), {}, { agent: { session: { id: 'web-session-abc' } } }, now());
A('web 会话不受影响', i1.allow === true && i1.why === 'not-qq', i1);

console.log('=== 电脑操控工具闸门 测试 ===');
let fail = 0;
for (const [n, pass, e] of ok) { console.log((pass ? 'OK  ' : 'FAIL ') + n + (pass ? '' : '   ' + JSON.stringify(e ?? null).slice(0, 160))); if (!pass) fail++; }
console.log(fail ? ('失败 ' + fail) : ('全部通过 ' + ok.length + '/' + ok.length));
await new Promise((r) => setTimeout(r, 150));
process.exitCode = fail ? 1 : 0;
