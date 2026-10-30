import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-multisrc-'));
const base = new URL('../lib/', import.meta.url).href;
const S = await import(base + 'sticker.js');
const { ensureDirs } = await import(base + 'store.js');
const { loadConfig } = await import(base + 'config.js');
ensureDirs();

// 本地 mock 源（端口随机，避免和别的测试/残留进程抢 9899）
const mock = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ license: { name: 'TEST-1.0' }, stickers: [
    { alt: '测试图1', tags: ['开心'], original: 'https://mock.local/a.png' },
    { alt: '测试图2', tags: ['吃饭'], original: 'https://mock.local/b.png' },
  ] }));
});
await new Promise((r) => mock.listen(0, '127.0.0.1', r));
const port = mock.address().port;

// 远端源用本地桩顶掉：不联网，测试才稳定
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes('fisharchive.cc')) {
    return new Response(JSON.stringify({ license: { name: 'TEST-1.0' }, stickers: [
      { alt: '远端图1', tags: ['开心'], original: 'https://fisharchive.cc/a.png' },
      { alt: '远端图2', tags: ['无语'], original: 'https://fisharchive.cc/b.png' },
      { alt: '远端图3', tags: ['吃饭'], original: 'https://fisharchive.cc/c.png' },
    ] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return realFetch(url);
};
const cfg = loadConfig();
cfg.sticker.remoteSources = ['https://fisharchive.cc/stickers/index.json', `http://127.0.0.1:${port}/index.json`];
let r
try {
  r = await S.syncRemote(cfg, { info() {} });
} finally {
  globalThis.fetch = realFetch;
  mock.close();
}
const ok = [];
ok.push(['返回成功', r.ok === true]);
ok.push(['两个源都有结果', (r.sources || []).length === 2]);
ok.push(['两个源都 ok', (r.sources || []).every((x) => x.ok)]);
ok.push(['两个源都进了图库', r.total >= 5]);
const st = S.stats();
ok.push(['来源统计里有两个 host', Object.keys(st.by).length >= 2]);
ok.push(['含 fisharchive', Object.keys(st.by).some((k) => k.includes('fisharchive'))]);
ok.push(['含本地 mock 源', Object.keys(st.by).some((k) => k.includes('127.0.0.1'))]);
const picked = S.pickSticker(cfg, 'G1', '吃饭');
ok.push(['按 mood 能挑到图', !!picked && JSON.stringify(picked).includes('吃饭')]);
console.log('=== 多图库源测试 ==='); let fail = 0;
for (const [n, p] of ok) { console.log(`${p ? '✅' : '❌'} ${n}`); if (!p) fail++ }
console.log('总数:', r.total, '| 来源:', JSON.stringify(st.by));
console.log(fail ? `失败 ${fail}` : '全部通过');
try { rmSync(process.env.DSH_HOME, { recursive: true, force: true }) } catch {}
// 断言失败要真的算失败（run-all 只看 exit code）
process.exitCode = fail ? 1 : 0;
process.exit(fail ? 1 : 0);
