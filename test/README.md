# 测试

59 个测试文件，每个都是独立的 ESM 脚本，跑完自己 `process.exit`。

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
| 要外网 | `media-dl-test` | 访问图床；没网会超时（不是代码退化） |

## 路径约定

测试里 import 的是**部署路径**：

```js
const base = "file:///C:/Users/Ranmi/.dsh/profiles/desktop/node_modules/dsh-qqbot-refine/"
```

也就是 `~/.dsh/profiles/<profile>/node_modules/dsh-qqbot-refine`（junction 指向 `~/.dsh/plugins/dsh-qqbot-refine`）。
换机器/换 profile 时改这一行即可。
