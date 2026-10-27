import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
const base = pathToFileURL(join(homedir(), '.dsh', 'profiles', 'desktop', 'node_modules', 'dsh-qqbot-refine')).href + '/';
const { plainChatText, splitBubbles, typingDelayMs } = await import(base + "lib/humanize.js");
const ok = [];
const eq = (n, got, want) => ok.push([n, JSON.stringify(got) === JSON.stringify(want), got, want]);

eq("粗体/标题/列表都清掉", plainChatText("## 结论\n- **第一**点\n- 第二点"), "结论\n第一点\n第二点");
eq("行内代码只留内容", plainChatText("用 `sendText` 就行"), "用 sendText 就行");
eq("链接只留文字", plainChatText("看 [这个](https://x.test/a) 啊"), "看 这个 啊");
eq("引用块去掉 >", plainChatText("> 原话\n嗯"), "原话\n嗯");
eq("多余空行压掉", plainChatText("a\n\n\n\nb"), "a\n\nb");
eq("普通中文不动", plainChatText("今天好热，想喝点冰的。"), "今天好热，想喝点冰的。");

eq("短句不分段", splitBubbles("好呀", 3, 12), ["好呀"]);
eq("两句拆两条", splitBubbles("今天好热啊。要不要喝冰的？", 2, 12), ["今天好热啊。", "要不要喝冰的？"]);
eq("碎片并到前一句", splitBubbles("真的假的！？好耶", 3, 12).length, 1);
eq("均衡拆两条", splitBubbles("一。二。三。四。", 2, 0), ["一。二。", "三。四。"]);
eq("超上限时最后一条装剩下的", splitBubbles("一二三。四五六。七八九。十十一十二。", 3, 0).length, 3);
eq("cap=1 不分", splitBubbles("一。二。三。", 1, 0), ["一。二。三。"]);

const d1 = typingDelayMs("嗯", { msPerChar: 25, maxMs: 2500, jitter: 0 });
ok.push(["短句至少 250ms", d1 >= 250, d1]);
const d2 = typingDelayMs("字".repeat(200), { msPerChar: 25, maxMs: 2500, jitter: 0 });
ok.push(["长句封顶 2500ms", d2 === 2500, d2]);
const d3 = typingDelayMs("字".repeat(40), { msPerChar: 25, maxMs: 2500, jitter: 0.2 });
ok.push(["带抖动且不越界", d3 >= 1000 && d3 <= 1500, d3]);

console.log("=== 像人（humanize）测试 ===");
let fail = 0;
for (const [n, pass, got, want] of ok) { console.log((pass ? "\u2705 " : "\u274c ") + n + (pass ? "" : ("   got=" + JSON.stringify(got) + " want=" + JSON.stringify(want)))); if (!pass) fail++ }
console.log(fail ? ("失败 " + fail) : "全部通过");
process.exit(fail ? 1 : 0);
