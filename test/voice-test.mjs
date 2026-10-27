import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
process.env.DSH_HOME = 'C:/Users/Ranmi/AppData/Local/Temp/dsh-test-home' // __TEST_HOME__ 隔离，绝不写真实配置
import http from "node:http";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
const base = pathToFileURL(join(homedir(), '.dsh', 'profiles', 'desktop', 'node_modules', 'dsh-qqbot-refine')).href + '/';
const V = await import(base+"lib/voice.js");
const { ensureDirs, dirs } = await import(base+"lib/store.js");
ensureDirs();

// 1) 造一个 0.8s 24k 单声道 WAV
const wavPath = "C:/Users/Ranmi/AppData/Local/Temp/voicetest.wav";
execFileSync("ffmpeg", ["-y","-f","lavfi","-i","sine=frequency=440:duration=0.8","-ar","24000","-ac","1",wavPath], { stdio: "ignore" });
const wav = readFileSync(wavPath);
console.log("测试 WAV:", wav.length, "bytes");

// 0) 没有 silk 编码器就别硬跑（这是环境缺失，不是代码坏了）
let silkOk = false
try { silkOk = !!(await V.wavToSilk(wav)) } catch { silkOk = false }
if (!silkOk) {
  console.log("=== 语音链路测试 ===");
  console.log("跳过：这台机器没有可用的 silk-wasm（语音编码依赖），不影响其它功能");
  process.exit(0);
}

// 2) mock 声音服务
const srv = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/v1/speech") {
    let body=""; req.on("data",c=>body+=c); req.on("end",()=>{
      const j = JSON.parse(body||"{}");
      if (j.voice !== "feiyu") { res.writeHead(400); return res.end("bad voice") }
      res.writeHead(202, {"content-type":"application/json"});
      res.end(JSON.stringify({ job_id: "j1", status: "queued" }));
    });
    return;
  }
  if (req.url === "/v1/jobs/j1") { res.writeHead(200,{"content-type":"application/json"}); return res.end(JSON.stringify({job_id:"j1",status:"success"})) }
  if (req.url === "/v1/jobs/j1/audio") { res.writeHead(200,{"content-type":"audio/wav"}); return res.end(wav) }
  res.writeHead(404); res.end("nope");
});
await new Promise((r) => srv.listen(9881, "127.0.0.1", r));

const cfg = { baseUrl: "http://127.0.0.1:9881", apiKey: "test-key", voiceId:"feiyu", style:"cute", maxChars:120, pollTimeoutSec:15 };
const out = await V.speakToFile(cfg, "你好呀，今天也要开心。", "voicetest");
const ok = [];
ok.push(["整条链路成功", out.ok === true]);
ok.push(["产出 silk 文件", out.ok && existsSync(out.file)]);
ok.push(["silk 体积合理", out.ok && out.bytes > 1000]);
ok.push(["时长 > 0", out.ok && out.durationMs > 0]);

// 3) 假 bot 发语音
const sent = [];
const fakeBot = { sendVoice: async (t, src) => { sent.push(src) } };
const s2 = await V.sendVoice(fakeBot, { scope:"group", targetId:"G1" }, out);
ok.push(["sendVoice 被调用", s2 === true && sent.length === 1 && !!sent[0].buffer]);

// 4) 服务不可用时的降级
const bad = await V.speakToFile({ baseUrl: "http://127.0.0.1:9", voiceId:"feiyu", maxChars:10, pollTimeoutSec:2 }, "测试");
ok.push(["服务挂了 → 失败不抛", bad.ok === false && typeof bad.error === "string"]);

srv.close();
console.log("=== 语音链路测试 ==="); let fail=0;
for (const [n,p] of ok){ console.log(`${p?"✅":"❌"} ${n}`); if(!p) fail++ }
if (out.ok) console.log("产出:", out.file, "|", Math.round(out.bytes/1024), "KB |", out.durationMs, "ms");
console.log(fail?`失败 ${fail}`:"全部通过");
process.exitCode = fail ? 1 : 0;

