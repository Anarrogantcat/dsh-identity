process.env.DSH_HOME = 'C:/Users/Ranmi/AppData/Local/Temp/dsh-test-payqr-live';
import { mkdirSync, rmSync, writeFileSync, existsSync, statSync, readFileSync } from 'node:fs';
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
const Q = await import(base + 'lib/payqr.js');
const { clone, DEFAULTS, FIELDS } = await import(base + 'lib/config.js');
const ok = []; const A = (n, c, e) => ok.push([n, !!c, e]);

// ── 1. 默认值与面板字段 ──
A('默认端口 9333', Q.LIVE_DEFAULTS.port === 9333);
A('默认是充值页', /deepseek\.com/.test(Q.LIVE_DEFAULTS.url) && /top_up/.test(Q.LIVE_DEFAULTS.url), Q.LIVE_DEFAULTS.url);
A('默认关闭实时码', DEFAULTS.usage.payLiveEnabled === false);
A('面板有实时码开关', FIELDS.some((f) => f.k === 'usage.payLiveEnabled' && f.t === 'bool'));
A('面板有端口/地址/金额/等待', ['usage.payLivePort', 'usage.payLiveUrl', 'usage.payLiveAmount', 'usage.payLiveWaitSec'].every((k) => FIELDS.some((f) => f.k === k)));
A('默认金额 10 元', Number(DEFAULTS.usage.payLiveAmount) === 10);

// ── 2. 浏览器没开：给人话，不崩 ──
const cfg = clone(DEFAULTS);
cfg.usage.payLivePort = 9;
cfg.usage.payLiveUrl = 'http://127.0.0.1:9/never';
const r1 = await Q.capturePayQr(cfg, { logger: { warn() {} } });
A('没浏览器 → ok=false', r1.ok === false, r1);
A('没浏览器 → 提示跑脚本', /pay-browser/.test(String(r1.error)), r1.error);
const p1 = await Q.probePayBrowser(9);
A('体检也返回 false', p1.ok === false, p1);
A('专用目录在数据目录下', Q.payProfileDir().replace(/\\/g, '/').endsWith('storages/dsh-qqbot-refine/pay-browser'), Q.payProfileDir());

// ── 3. 真跑一遍：headless Edge + 假充值页（¥10 / 去支付 / canvas）──
const candidates = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];
const edge = candidates.find((p) => existsSync(p));
if (!edge) {
  A('真跑一遍（无 Edge，跳过）', true);
} else {
  const { spawn } = await import('node:child_process');
  const port = 9334 + Math.floor(Math.random() * 40);
  const prof = join(process.env.TEMP || HOME, 'payqr-edge-' + Date.now());
  // 尽量照着真实页面来：金额/方式都是 radio，按钮是 span.ds-button__content，码在 .ds-qr-code
  const html = '<!doctype html><meta charset=utf-8><body>' +
    '<label><input type=radio name=amt value=10>¥10</label>' +
    '<label><input type=radio name=amt value=20>¥20</label>' +
    '<label><input type=radio name=m value=wechat>微信支付</label>' +
    '<div class=ds-button__content style="width:200px">去支付</div>' +
    '<div class=ds-qr-code style="margin:40px"><canvas width=220 height=220></canvas></div>' +
    '</body>';
  const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
  const child = spawn(edge, [
    '--headless=new', '--remote-debugging-port=' + port, '--user-data-dir=' + prof,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars', 'about:blank',
  ], { stdio: 'ignore', windowsHide: true });
  try {
    let up = false;
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 250));
      try { const res = await fetch('http://127.0.0.1:' + port + '/json/version'); if (res.ok) { up = true; break } } catch { }
    }
    A('headless Edge 起来了', up);
    if (up) {
      const c2 = clone(DEFAULTS);
      c2.usage.payLivePort = port;
      c2.usage.payLiveUrl = dataUrl;
      c2.usage.payLiveWaitSec = 8;
      const r2 = await Q.capturePayQr(c2, { logger: { warn() {} } });
      A('能点到金额+去支付并截到码', r2.ok === true, r2);
      A('产出 png 文件', r2.ok && existsSync(r2.path) && statSync(r2.path).size > 500, r2);
      if (r2.ok && existsSync(r2.path)) {
        const buf = readFileSync(r2.path);
        A('真的是 PNG', buf[0] === 0x89 && buf.slice(1, 4).toString() === 'PNG', buf.slice(0, 8).toString('hex'));
      }
      const pr = await Q.probePayBrowser(port);
      A('体检返回 ok 且带地址', pr.ok === true && !!pr.url, pr);
    }
  } finally {
    try { child.kill() } catch { /* ignore */ }
    try { rmSync(prof, { recursive: true, force: true }) } catch { /* ignore */ }
  }
}

console.log('=== 实时充值码（CDP 截图）测试 ===');
let fail = 0;
for (const [n, pass, e] of ok) { console.log((pass ? 'OK  ' : 'FAIL ') + n + (pass ? '' : '   ' + JSON.stringify(e ?? null).slice(0, 160))); if (!pass) fail++; }
console.log(fail ? ('失败 ' + fail) : ('全部通过 ' + ok.length + '/' + ok.length));
await new Promise((r) => setTimeout(r, 150));
process.exitCode = fail ? 1 : 0;
