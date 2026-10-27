import { pathToFileURL } from 'node:url';
import { homedir } from 'node:os';
import { join } from 'node:path';
const base = pathToFileURL(join(homedir(), '.dsh', 'profiles', 'desktop', 'node_modules', '@tencent-connect', 'dsh-qqbot', 'dist', 'transport', 'attachment.js')).href;
const { downloadMediaAttachments } = await import(base);
import { existsSync, statSync, unlinkSync } from "node:fs";
const logger = { debug: (m) => {}, warn: (m) => console.log("WARN", m), info: () => {} };
// 用公开图床验证「下载链路」本身（不依赖 QQ 链接时效）
const url = "https://fisharchive.cc/media/chatgpt-renwu-jieshao.png";
const out = await downloadMediaAttachments([{ content_type: "image/png", filename: "probe.png", url }], { enabled: true, maxMB: 5 }, logger);
console.log("返回:", JSON.stringify(out));
let ok = out.length === 1 && existsSync(out[0].localPath);
console.log(ok ? "OK  下载成功，落盘 " + Math.round(statSync(out[0].localPath).size/1024) + "KB" : "FAIL 没有落盘");
// 内网地址必须仍然被拦（SSRF 不能被这个补丁放过）
try {
  const bad = await downloadMediaAttachments([{ content_type: "image/png", filename: "bad.png", url: "https://127.0.0.1/x.png" }], { enabled: true, maxMB: 5 }, logger);
  console.log(bad.length === 0 ? "OK  内网地址仍被拒" : "FAIL 内网地址竟然下载了");
} catch (e) { console.log("OK  内网地址抛错被拒:", e.message); }
if (ok) { try { unlinkSync(out[0].localPath) } catch {} }
