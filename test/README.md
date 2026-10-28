# 测试

127 个测试文件，每个都是独立的 ESM 脚本，跑完自己 `process.exit`。

```powershell
node test/run-all.mjs          # 全部
node test/run-all.mjs onebot   # 只跑名字带 onebot 的
```

运行器会给每个文件建一个临时 `DSH_HOME`，跑完删掉，互不污染。

## 两类要注意的测试

| 类型 | 例子 | 说明 |
|---|---|---|
| 纯本地 | `marker-leak-test`、`safety-test`、`cognition-test` | 不需要网络，最稳 |
| 起本地端口 | `multisrc-test`（9899）、`mood-*` | **不要并发跑两份**，端口会撞 |
| 要外网 | `draw-confirm-test` 的搜索摘要、`payqr-live-test` | 没网会跳过或超时（不是代码退化） |

## 路径约定

测试 import 的是**仓库源码**（`test/` 的上一级），不碰部署目录：

```js
const base = new URL('../', import.meta.url).href;
const X = await import(base + "lib/x.js");
```

需要读 `panel.html` / `index.js` / `package.json` 时也用 `new URL('../…', import.meta.url)`。
换目录/换机器都不需要改。
