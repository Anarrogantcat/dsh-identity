# dsh-identity

> DeepSeek Harness（DSH）的**身份系统**插件：让「大肥鱼」不是一张角色卡，而是一个会记事、有情绪、会判断要不要开口、并会被经历改变的状态。
> 内核、记忆、关系、精力、自主与成长都落在本机；**身份段与面板在任意 DSH 会话生效，不接 QQ 也能用**。QQ（NapCat / OneBot 11）只是第一个通道，额外提供接话判断、主动开口和群治理。
>
> 现在还在长：`durable` 需要跨 ≥2 天、同条习惯 ≥3 次证据；不承诺“已经像人”，只保证机制真实、可查、可纠正。

由 **鲸鱼娘** ＆ **染喵** 一起折腾，长期在真实群里跑，问题都是被群友骂出来的。

## 它是什么

一个跑在 DSH 里的身份底座，分五层：

| 层 | 内容 |
|---|---|
| L1 身份 | 一个可编辑**内核**（你给的，连底线一起写）· 自动场景（群聊/私聊/DSH）· 证据制 **traits**（≥3 次 + 跨 ≥2 天，可晋升/退休） |
| L2 认知 | 事件流 · 选择性记忆（过滤表情/短反应）· 日记 · 日/周/月复盘 · 承诺 · 心情 v2（七情六欲 + 复合情绪）· 情绪调节（极端回落 + 提示）· 共情事件（按好感度决定温度/策略）· 自我模型（连续自我 + 历史快照）· 精力/频率 · 成长指标 |
| L2.5 自主 | 目标由好奇/没接住的话题提议，你批准后即时执行；拖太久会自弃；主动开口受精力/心情/理由约束，没理由不刷屏 |
| L3 治理 | 策略与限额、确认码、调度器（租约/幂等/熔断）、预算降级、支付网关（分级钱包/双授权）、审计 |
| L4 能力 | 生图、语音（WSL 按需拉起，闲置 15 分钟自动关）、联网搜索（被质疑没搜时会真搜）、媒体发送、小黑盒、MCP、桌面操控——统一能力契约 + 策略 + 超时 + 审计 |
| L5 通道 | `lib/channel.js` 通道契约；QQ adapter + web 会话成长（宿主 `session/event`），核心不依赖任何通道 |

## 当前版本与状态（1.9.187）

- 决策统一入口：`decideInbound` / `decideSocial`；安全 pre-check 独立
- 社交判断：名字、被提到、接续、群问、判断器、闲聊参与
- 频率：精力 + 心情 + 10 分钟计数；Owner 不受限
- 记忆：选择性入库，过滤表情、短反应、纯 @
- 压缩：压力到 `session.compactAt`（默认 0.85）前归档、轮换 sid，带最近 8 条 + 摘要 + 承诺 + 目标
- 共情：5 类情绪 × 2 级温度 + 策略标签；按好感度决定谁值得多花成本
- 测试：132 文件；`npm test`

> 还没完成：`durable` 需要跨 ≥2 天、同条习惯 ≥3 次证据；不是代码没接。

## 为什么不是「QQ 机器人」

- 核心层（身份/认知/治理/自主）**不 import** 任何 QQ 模块（`gate`、`onebot`、`transport`）
- 身份注入对所有会话生效；QQ 是通道，不是她的前提
- 换通道只加 adapter，不改人格与记忆

## 安装（DSH 插件）

环境要求：DSH **0.2.x**、Node.js **≥20**；这个仓库没有发布 npm，只支持 GitHub / 本地路径。

### 方式一：命令从 GitHub 装（推荐）

```powershell
# 桌面 profile；web 把 desktop 换成 web
dsh plugin --profile desktop add github:Anarrogantcat/dsh-identity
```

装完确认 profile 的 `bundles` 里有 `dsh-identity`（没有就手动加一行），然后重启 DSH。
插件列表里应显示 **大肥鱼 · 身份系统**（不是市场里 `ouransishen/dsh-identity`，那是另一个项目）。
面板入口：客户端浮标 🐟 或 `/qqbot-refine`。

### 方式二：本地目录 / npm

```powershell
dsh plugin --profile desktop add file:C:\path\to\dsh-identity
# 发布 npm 后：dsh plugin --profile desktop add dsh-identity
```

### 方式三：手动放插件并改 profile

1. 把仓库放进 `~/.dsh/plugins/dsh-identity`
2. 在 profile 的 `package.json` 加依赖：`"dsh-identity": "file:../../plugins/dsh-identity"`
3. bundles 里加入 `dsh-identity`；或使用 bundle patch：

   ```yaml
   - insert:
       - id: dsh-identity
         name: dsh-identity
         config: { enabled: true }
   ```

4. 重启 DSH；面板入口：客户端浮标 🐟 或 `/qqbot-refine`

**注意**：仓库目前**没有发布到 npm**，裸包名装不了；用 `github:` 或本地 `file:` 路径。

**不依赖第三方人设/心情插件**；数据在 `~/.dsh/storages/dsh-identity`。
兼容说明：包名、bundle id、客户端 id 都是 `dsh-identity`；不要再用旧 id `qqbot-refine` 装新配置。

## 面板

总览 / 身份 / 认知（心情·画像·记忆·关系）/ 自主 / 治理（隐私·用量）/ 能力（表情·生图·语音）/ 通道（QQ）/ 系统。

- 总览：接话决策、精力、会话压力/接续、最近判断、最近对话、立即压缩
- 身份页：内核、精力/频率、traits、承诺、自我模型（折叠）、自我历史（折叠）、最近复盘（折叠）
- 认知→心情：心情卡、共情事件、共情温度/策略/结果
- 设置项默认折叠，避免一屏开关

## 常用命令（QQ 群）

`#身份` · `#承诺` / `#兑现` · `#目标` / `#批准` / `#放弃` · `#调节 <参数> <值>` · `#画`（先搜 → 再问 → 确认）· `#说话` · `#MCP <server> <tool> [JSON]` · `#支付` / `#确认支付`

## 收款码（每个实例自己配）

仓库/插件里**不包含任何收款码**，默认也是关的。装到自己机器上后：

1. 面板「用量」→ 打开「允许发收款码」
2. 填「收款码图片路径」（本机绝对路径），或填「收款码文件夹」让它发里面最新的一张
3. 群里 `#充值码`：群友拿静态码；主人可以走实时截图（需先跑 `scripts/pay-browser.ps1` 并登录一次）

注意：`usage.payQrPath` 指向的是**你本机**的图片，不会随插件分发；别把它提交进仓库。

## B站（可选，她自己的账号）

每个实例用**自己的** B站 账号，仓库里不含任何登录态：

1. 运行 `powershell -ExecutionPolicy Bypass -File scripts\bili-browser.ps1`
2. 在弹出的专用 Edge 里登录你的 B站 账号（只存到本机 `storages/dsh-identity/bili-browser`）
3. 群里 `#B站 看 <BV/链接>` 读标题/简介/数据/热评；`#B站 搜 <关键词>` 搜视频

自动发评论没有做：B站评论区懒加载/风控，硬做有账号风险。每个用户各登录各的，不共享。

## 语音安装辅助脚本（可选）

不是 `dsh plugin add` 一条命令就能装完：声音服务是独立的 Python/GPU 服务。仓库提供检查脚本：

```powershell
# 只检查 GPU / WSL / git，不安装
powershell -ExecutionPolicy Bypass -File scripts\install-voice.ps1

# 拉取声音服务仓库，并打印 WSL 内的安装命令
powershell -ExecutionPolicy Bypass -File scripts\install-voice.ps1 -Install -Backend cuda
```

脚本不会自动下载大模型、不会替你确认显卡/驱动，也不会写 API Key。模型下载、`configs/runtime.*.local.json` 和 `voice_service.json` 仍按声音服务仓库的 `server/INSTALL_AGENT.md` 配置。

## 语音（可选，小肥鱼声库）

语音**不包含在本插件里**：音色和推理都在独立的「小肥鱼声音服务」，本插件只负责调它。

1. 部署声音服务（任选一种）
   - 仓库：`github.com/Esmerubphire/astrbot_plugin_feiyu_voice`
   - 按 `server/INSTALL_AGENT.md` 安装；推荐 Windows + WSL2，NVIDIA 走 CUDA
   - 首次安装会下载引擎、依赖和模型（体积大，需要显卡/磁盘）
2. 启动服务，记下端口（默认 9880，本机当前是 9881）和它生成的 API Key
3. 面板「语音」填：
   - `baseUrl`：`http://127.0.0.1:9881`
   - `apiKey`：服务端生成的 key
   - `voiceId`：`feiyu`；`style`：`cute` / `gentle`
4. 测试：群里 `#语音 你好呀`（或 `#说话 你好呀`）；成功会发语音
5. 资源：服务常驻约数 GB 显存/内存；`voice.idleStopMin` 默认 15 分钟，闲置后整个 WSL 自动关闭，下次用语音再拉起；和本地生图共用显卡时，建议开 `draw.freeAfter`，别同时跑

注意：每个用户各自部署、各自的 key 和模型；仓库不提供声库文件，也不要共享别人的服务地址。

## 测试

```bash
npm install
npm test          # 132 个测试文件
```

含 UI 渲染冒烟（19 页）与交互冒烟（逐页点按钮）；面板空白或按钮抛错会直接红。

## 状态与边界

- 版本 `1.9.187`；QQ 通道功能完整，web 会话可积累并召回记忆
- `gate.js` 实现已移入 `lib/channel-qq/`，`lib/gate.js` 是兼容 re-export
- 「像人」不是调参调出来的：traits / 复盘 / 关系都需要时间积累
- 隐私、支付、工具权限由代码闸门执行，改内核文案绕不过去

## License

MIT
