process.env.DSH_HOME = 'C:/Users/Ranmi/AppData/Local/Temp/dsh-test-update';
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
const HOME = process.env.DSH_HOME;
try { rmSync(HOME, { recursive: true, force: true }) } catch {}
mkdirSync(HOME + '/profiles/desktop', { recursive: true });
writeFileSync(HOME + '/profiles/desktop/cordis.patch.yml', "- id: im-qqbot\n  config:\n    appId: '1905982004'\n    appSecret: dummy\n", 'utf8');
const { pathToFileURL } = await import('node:url');
const { homedir } = await import('node:os');
const { join } = await import('node:path');
const { spawnSync } = await import('node:child_process');
const base = new URL('../', import.meta.url).href;
const { ensureDirs, dirs } = await import(base + 'lib/store.js');
ensureDirs();
const U = await import(base + 'lib/update.js');
const ok = []; const A = (n, c, e) => ok.push([n, !!c, e]);

// ── 1. 版本号比较 ──
A('0.10.0 > 0.9.32', U.compareVersions('0.10.0', '0.9.32') === 1);
A('0.9.32 < 0.10.0', U.compareVersions('0.9.32', '0.10.0') === -1);
A('相等 = 0', U.compareVersions('1.2.3', '1.2.3') === 0);
A('v 前缀也认', U.compareVersions('v1.0.1', '1.0.0') === 1);
A('坏版本号不炸', U.compareVersions('abc', '1.0.0') === 0);
A('parseVersion 三段', JSON.stringify(U.parseVersion('v1.2.3-beta')) === '[1,2,3]', U.parseVersion('v1.2.3-beta'));

// ── 2. 当前版本 / 目录 / pnpm 保护 ──
const pkg = JSON.parse(readFileSync(new URL('package.json', base), 'utf8'));
A('当前版本读得到', U.currentVersion() === pkg.version, [U.currentVersion(), pkg.version]);
A('插件目录是真实路径', /dsh-qqbot-refine/.test(U.pluginDirOf()), U.pluginDirOf());
A('pnpm 目录被识别', U.isPnpmManaged('C:/x/node_modules/.pnpm/dsh-qqbot-refine@1.0.0/node_modules/dsh-qqbot-refine') === true);
A('普通目录不算 pnpm', U.isPnpmManaged('C:/Users/x/.dsh/plugins/dsh-qqbot-refine') === false);

// ── 3. 查最新版（打桩 fetch）──
const goodFetch = async () => ({ ok: true, json: async () => ({ version: '99.0.1' }) });
const r1 = await U.checkLatest({ fetchImpl: goodFetch });
A('查最新版成功', r1.ok === true && r1.latest === '99.0.1', r1);
A('缓存写下来了', U.readCache()?.latest === '99.0.1', U.readCache());
const badFetch = async () => { throw new Error('offline') };
const r2 = await U.checkLatest({ fetchImpl: badFetch });
A('断网时给人话', r2.ok === false && /offline/.test(String(r2.error)), r2);
const http500 = async () => ({ ok: false, status: 500 });
A('500 也算失败', (await U.checkLatest({ fetchImpl: http500 })).ok === false);

// ── 4. 覆盖安装（在临时目录上真跑一遍 tar 流程）──
const tmp = join(process.env.TEMP || HOME, 'upd-probe-' + Date.now());
const srcRoot = join(tmp, 'src');
const pkgDir = join(srcRoot, 'dsh-qqbot-refine-master');
mkdirSync(join(pkgDir, 'lib'), { recursive: true });
mkdirSync(join(pkgDir, 'docs'), { recursive: true });
writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: 'dsh-qqbot-refine', version: '0.0.2' }));
writeFileSync(join(pkgDir, 'index.js'), 'export const name = "x"\n');
writeFileSync(join(pkgDir, 'lib', 'a.js'), 'export const a = 2\n');
writeFileSync(join(pkgDir, 'docs', 'n.md'), '# new\n');
const tgz = join(tmp, 'pkg.tar.gz');
const tarRes = spawnSync('tar', ['-czf', tgz, '-C', srcRoot, 'dsh-qqbot-refine-master'], { windowsHide: true });
A('造好了测试包', tarRes.status === 0 && existsSync(tgz), String(tarRes.stderr ?? ''));
const tarBytes = readFileSync(tgz);

const target = join(tmp, 'plugin');
mkdirSync(join(target, 'lib'), { recursive: true });
mkdirSync(join(target, 'docs'), { recursive: true });
writeFileSync(join(target, 'package.json'), JSON.stringify({ name: 'dsh-qqbot-refine', version: '0.0.1' }));
writeFileSync(join(target, 'index.js'), 'old\n');
writeFileSync(join(target, 'lib', 'old.js'), 'old lib\n');
writeFileSync(join(target, 'docs', 'old.md'), 'old doc\n');

const fetchTar = async () => ({ ok: true, arrayBuffer: async () => tarBytes.buffer.slice(tarBytes.byteOffset, tarBytes.byteOffset + tarBytes.byteLength) });
const up = await U.applyUpdate({ dir: target, from: '0.0.1', fetchImpl: fetchTar, logger: { info() {}, warn() {} } });
A('更新成功', up.ok === true && up.to === '0.0.2', up);
A('新文件覆盖了旧的', readFileSync(join(target, 'index.js'), 'utf8').includes('name = "x"'));
A('新 lib 生效', existsSync(join(target, 'lib', 'a.js')));
A('旧 lib 被清掉', !existsSync(join(target, 'lib', 'old.js')));
A('旧 docs 也被整目录替换', !existsSync(join(target, 'docs', 'old.md')) && existsSync(join(target, 'docs', 'n.md')));
A('返回里提了要重启', up.needsRestart === true, up);
A('备份目录存在且有旧文件', !!up.backup && existsSync(join(up.backup, 'lib', 'old.js')), up.backup);

const up2 = await U.applyUpdate({ dir: 'C:/x/node_modules/.pnpm/pkg/node_modules/dsh-qqbot-refine', fetchImpl: fetchTar });
A('pnpm 目录拒绝原地覆盖', up2.ok === false && up2.needManual === true, up2);

try { rmSync(tmp, { recursive: true, force: true }) } catch {}

console.log('=== 自更新（查版本 / 备份 / 覆盖）测试 ===');
let fail = 0;
for (const [n, pass, e] of ok) { console.log((pass ? 'OK  ' : 'FAIL ') + n + (pass ? '' : '   ' + JSON.stringify(e ?? null).slice(0, 160))); if (!pass) fail++; }
console.log(fail ? ('失败 ' + fail) : ('全部通过 ' + ok.length + '/' + ok.length));
await new Promise((r) => setTimeout(r, 150));
process.exitCode = fail ? 1 : 0;
