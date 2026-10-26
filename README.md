# dsh-qqbot-refine

> 作者：**鲸鱼娘** ＆ **染喵**

给 [DeepSeek Harness](https://github.com/deepseek-ai) 的 QQ 机器人加一层「能管得住」的增强：
**频率闸 · 隐私脱敏 · 人设 · 半衰期记忆 · 群成员画像 · 表情包 · 层级与群管 · B站动态与链接解析**。

## 更新日志

- **0.6.0**：语音资源下载中心（whisper 模型 / ffmpeg，可放别的盘）、数据目录可整体挪盘（`.data-path` 指针 / `QQBOT_REFINE_HOME`）、面板语音页资源卡、`scripts/move-data.ps1`
- **0.5.0**：S3–S7（入站事件 / 出站动作 / 安全熔断 / 认知四张卡）、面板通道页与知识库、赛程页、名册卡、`#群列表` `#群成员` `#踢人` `#名片` `#赞`
- **0.4.0**：自建 OneBot 通道（不依赖其他 DSH 插件）、名册、能力位
- **0.3.0**：P0（安装恢复、标记泄漏、启动自检）、通道抽象

> 所有闸门都在模型之前生效：命令、推送、禁言/撤回、图库同步 **不消耗任何 token**；
> 只有正常对话与（可选的）记忆归纳/画像归纳会产生 token。

## 功能一览

| 模块 | 说明 | token |
|---|---|---|
| 频率 | **群对话模式（仅@ / 自然接话）**、非 @ 每 N 条回一次、小名触发、冷却、每分钟上限、免打扰、随机跳过 | 0 |
| 隐私 | 白名单群/私聊、敏感词丢弃、**出站脱敏**（密钥/路径/模型名）、文件外发路径白名单、非 owner 禁用斜杠命令 | 0 |
| 人设 | **人设库 + 三级作用域**（全局 / 按群 / 按私聊），支持导入、启停、预览；只用 QQ 会话 | ≈150/轮 |
| 记忆 | 半衰期淡忘 + 提及强化，只淡忘不删除；每轮只注入 Top3 | ≈60–90/轮 |
| 画像 | 群内发言统计（本地 0 token），语义归纳可选 | 0 / 可选 |
| 表情包 | 远程图库（按需下载）+ 群内收集（TTL 过期）+ 可选自生成 | 0（自生成花图像 API 额度） |
| 层级 | Owner / Admin（QQ 群主·群管自动识别）/ Member / Guest，手动优先 | 0 |
| 群秩序 | 撤回、禁言/解禁、**闭麦**（#闭嘴 / #说话） | 0 |
| B站 | 动态推送、链接解析（智能降画质、可选截取） | 0 |

## 通道：官方 / 自建 OneBot（二选一）

`transport.mode` 决定走哪条路，**单活、不共存**：

| 模式 | 连接方式 | 能力 | 依赖 |
|---|---|---|---|
| `tencent` | 官方 QQ 机器人 SDK（`@tencent-connect/dsh-qqbot`），本插件挂 `QQBot.prototype` 钩子 | 7 项（官方限制：拿不到群名片/成员列表/撤回事件/戳一戳/合并转发/表情回应/引用） | 官方通道插件 |
| `onebot` | **本插件自己**连 NapCat 的 `websocketServers`（OneBot 11） | 15 项全开 | **零**——不需要任何其他 DSH 插件 |

`onebot` 模式下整条链路都在本插件里：
`NapCat → OneBotClient → 闸门（频率/隐私/命令）→ 宿主 agent → 出站闸门（脱敏/标记/拆气泡）→ OneBot 发送`。
只借用宿主自带的 `agents / sessions / agentPresets` 服务，不 import 宿主的 `@deepseek-ai/*` 包。

### NapCat 侧要做的（一次性）

1. WebUI `http://127.0.0.1:6099` → 网络配置 → **Websocket 服务器** → 新增：
   `host=127.0.0.1`、`port=3001`、`token=<随机 32 位>`、`messagePostFormat=array`、`reportSelfMessage=否`
2. 保存 → 重启 NapCat（Yunzai 那条 `websocketClients` 不受影响）
3. 面板「通道」页填：模式 `onebot`、地址 `ws://127.0.0.1:3001`、token；重启 DSH

### 行为

- **每群/每个私聊一个 DSH 会话**：sessionId = sha256(`qqbot-refine:onebot:<scope>:<peer>`)，重启时 `resume` 同一条历史
- 群里喂给模型的正文形如 `[群名片(QQ)] 内容 (@你)`；群名片优先取名册，取不到才用 QQ 昵称
- 出站媒体：图片（本地/网络）、语音（silk base64）、视频、文件（`upload_group_file` / `upload_private_file`）
- 入站目前把图片/语音标成 `[图片]` / `[语音]` 占位（图库收集、表情包仍照常）
- 新命令（仅 onebot 模式）：`#群列表`、`#群成员`（Owner/Admin）

## NapCat 专属能力（onebot 模式才有）

| 组 | 能力 | 怎么用 |
|---|---|---|
| 入站 | **撤回不答** | 消息被撤回后，排队里的这条不再投给模型 |
| 入站 | **被戳有反应** | 戳她一下会回一句（每群 3 次/分钟上限，不花 token） |
| 入站 | **合并转发展开** | 转发内容拍平成「谁：说了什么」再喂模型 |
| 入站 | **引用原文** | 引用消息会带「[引用：…]」前缀（缓存没命中就问 NapCat 要） |
| 入站 | **表情回应 / 成员变动** | 记审计；进退群/改名/管理员变动自动刷新该群名册（1 分钟节流） |
| 入站 | **语音转写** | 可选：`stt.enabled` + `stt.command`（`{file}` / `{out}` 占位），没配就留 `[语音]` |
| 出站 | **引用回复** | 群里回复自动引用触发的那条（`transport.onebot.quoteReply` 可关） |
| 出站 | **定时撤回** | `order.autoRecallEnabled` + `autoRecallDelaySec`，发完 N 秒自动撤 |
| 出站 | **视频 / 文件 / 语音** | 图片、silk 语音、视频、`upload_group_file` 都走 OneBot |
| 出站 | **贴表情回应** | `#赞`（对当前消息点赞），走 `set_msg_emoji_like` |
| 群管 | **禁言 / 解禁 / 踢人 / 改名片 / 撤回** | 命令见下；权限不够会明说，不会假成功 |

## 钱与安全

- **真实用量**：按 DSH 会话快照的 `tokenUsage` 折算成元；onebot 模式用本插件自己的会话 id 前缀，不串号
- **花费硬闸**（默认关）：`usage.hardLimitEnabled` 打开后超限自动 `degrade`（回一句模板）或 `mute`（静默）
- **失败熔断**：连续 3 次发送失败 → 保护 30 分钟，只对 Owner 说话；面板能看到剩余时间
- **被踢自动摘白名单**：收到自己离群事件就把该群从 `scope.groups` 移除并记审计
- **被禁言自动闭麦**：收到针对自己的 `group_ban` 就按剩余时长闭麦
- **安全档位**：`safety.profile = normal | safe`（safe：每小时 30 / 每天 150 / 间隔 ≥8s / 私聊陌生人禁）

## 认知四张卡（S7，0 token）

注入到人设段，每次只给「有用的那几句」：

```
# 在场的人（按最近活跃）
· 染喵（群主）：今天说过 12 句
# 我刚才说过/答应过
说过：押 HLE；答应过：明天帮你查赛程
# 还没答完的
5 分钟前「大肥鱼你说说分析」——当时在冷却没回
# 群里最近在聊
· 2026-10-26 21:00 …
```

- 数据在 `<store>/relations/`（关系图）、`<store>/self/`（自述/承诺）、`<store>/todos/`（待办）、`<store>/digest/`（每小时摘要）
- 待办会**自动补一句**：冷却过后 30 分钟内补一次（每群 30 分钟最多一条）
- 离线巩固：每 10 分钟把白名单群的聊天本地压成 ≤50 字摘要（不调模型）

## 命令（# 开头，0 token）

`绑定` `绑定本群` `群状态` `群列表` `群成员` `闭嘴` `说话` `撤回` `禁言` `解禁` `踢人` `名片` `赞` `记得` `忘掉` `记忆` `人设` `表情` `B站` `赛程` `交手` `用量` `帮助`

> `#群列表` `#群成员` `#踢人` `#名片` `#赞` 只在 onebot 模式可用；管理类命令仅 Owner / Admin。

## 语音资源下载（大文件，可放别的盘）

语音转写要两个外部东西，都不小，默认落在数据目录，**可以整体挪到别的盘**：

| 资源 | 大概 | 说明 |
|---|---|---|
| Whisper 模型 small | 466MB | 识别质量好 |
| Whisper 模型 base | 142MB | 省地方，够听清日常 |
| FFmpeg essentials | 80MB | 语音转 wav / 视频转码 |

面板 →「语音」页顶部有「语音资源」卡片：看状态、点下载、删掉重下。下载好模型后在卡片上点 **启用转写**，会自动把 `stt.command` 写成指向该模型（前提：`whisper-cli` 在 PATH 里）。

### 目录怎么挪（C 盘放不下时）

- **只挪大文件**：面板「语音」页填 `paths.downloadsDir`（例如 `D:\qqbot-assets`），保存即可
- **整个数据目录挪盘**：

```powershell
.\scripts\move-data.ps1 -Target 'D:\qqbot-data' -WhatIf   # 先看
.\scripts\move-data.ps1 -Target 'D:\qqbot-data'           # 复制并写指针
.\scripts\move-data.ps1 -Target 'D:\qqbot-data' -Move     # 搬走（源目录只留 .data-path）
```

原理：默认目录里留一个 `.data-path` 指针文件，插件启动时读它决定数据目录；也可以用环境变量 `QQBOT_REFINE_HOME` 强制指定（优先级最高）。改完 **重启 DSH** 生效。

## 项目目录 / 开发与部署

```
D:\AI\DeepSeek Harness Workspace\dsh-qqbot-refine   ← 项目目录（git 仓库：源码 + docs/ + test/）
C:\Users\Ranmi\.dsh\plugins\dsh-qqbot-refine         ← 部署目录（DSH 真正加载的地方）
```

改完代码要同步到部署目录（profile 里的 junction 指向那里）：

```powershell
.\scripts\sync-to-deploy.ps1            # 同步有变化的文件（只动 index/client/panel/lib 等运行文件）
.\scripts\sync-to-deploy.ps1 -WhatIf    # 先看会动哪些
.\scripts\sync-to-deploy.ps1 -Restart   # 顺手提醒：服务端代码要重启 DSH
```

- 只改 `panel.html` → 同步后**刷新页面**即可，不用重启
- 改 `index.js` / `lib/*` → 必须**重启 DSH**
- `docs/` `test/` `scripts/` 只留在项目目录，不进部署目录

## 安装（DSH 插件协议）

本插件遵循 DSH 的「一切皆插件」约定（cordis 插件 + bundle patch + webServer 面板）：

1. 放到 profile 的 `node_modules/` 下，或在 profile 的 `package.json` 里加依赖；
2. 在 `dsh.profile.bundles` 里加一行 `"dsh-qqbot-refine"`；
3. 重启 DSH。

插件自带的 `cordis.patch.yml` 会插入 `id: qqbot-refine` 条目。

> **不修改**宿主与第三方插件源码：全部通过 `QQBot.prototype` 的运行时钩子（入站 `handleInboundMessage`、出站 `sendText/sendMarkdown/send/sendFile`）与 `systemPrompt.section` 实现。
> 钩子装不上时**自动降级放行**，绝不吞消息。

## 界面

两种打开方式：

1. **右下角悬浮按钮 🐟**（浏览器半边，`client.js`）——点一下弹出控制面板，`Esc` 或遮罩可关；
   面板里的「新窗口打开」可在独立标签页常驻。
2. **直接访问** `http://127.0.0.1:<DSH端口>/qqbot-refine`（仅 loopback）。

悬浮按钮只用 DOM 实现，不依赖 slot 契约，DSH 升级后不易失效；若宿主未加载客户端半边，用方式 2 即可。

**悬浮按钮可以拖动**：按住拖到任意位置（贴边 6px 会夹住），松手记住位置（`localStorage: qqrefine:fabPos`），
点一下仍然是打开面板（位移 <5px 才算点击，拖完不会误开）。指针事件 + rAF 合帧，拖动期间没有过渡动画，跟手。

## 配置面板

启动后打开：`http://127.0.0.1:<DSH端口>/qqbot-refine`（只允许 loopback 访问）

配置落盘：`<DSH_HOME>/storages/dsh-qqbot-refine/settings.json`（保存即热生效）

### 人设库

- 位置：面板「人设」页；数据在 `<store>/presets.json`
- 内置三套：`大肥鱼·群聊短句` / `大肥鱼·私聊长版` / `群助手·克制版`（内置不可改文本，可另存为新）
- 作用域：`按私聊 → 按群 → 全局当前`，越细越优先；未指定时自动回落
- 操作：设为当前 · 启用/停用 · 看全文 · 导入新建 · 删除（仅导入的）
- 命令：`#人设`（看当前与列表）、`#人设 切换 <名称>`（Owner/Admin）
- 与宿主其他人设插件共存：`order` 可调，建议 120

## 命令（`#` 开头，不进模型、0 token）

| 命令 | 谁 |
|---|---|
| `#绑定本群` `#群状态` | Owner / Admin |
| `#闭嘴 30m` `#说话` | Owner / Admin |
| `#撤回 <msgId>` `#禁言 <openid> 10m` `#解禁 <openid>` | Owner / Admin |
| `#记得 内容` `#忘掉 关键词` `#记忆` | Owner / Admin |
| `#表情 <mood>` `#同步图库` | Owner / Admin |
| `#B站 <链接>` `#B站订阅 <mid>` `#B站订阅列表` `#B站推送 开\|关` | Owner / Admin（推送开关仅 Owner） |
| `#用量` | Owner / Admin |
| `#帮助` | 白名单内任何人 |

斜杠命令（`/model` `/preset` `/compact` `/stop` …）**只有 Owner 可用**，其余一律静默丢弃。

## 数据与隐私

```
<DSH_HOME>/storages/dsh-qqbot-refine/
  settings.json          配置
  state.json             闭麦/冷却/配额
  roles-cache.json       群成员角色缓存（1h）
  memory/<peerKey>.json  半衰期记忆
  profiles/<group>/      群成员画像
  stickers/              图库索引与文件（remote / collected / generated）
  bili/                  B站订阅与游标
  logs/audit.jsonl       审计（禁言/撤回/闭麦/图库同步）
```

- 群与私聊记忆**严格隔离**；跨群不共享
- 出站内容自动脱敏：`sk-*`、`Bearer …`、`api_key=…`、绝对路径、`~/.dsh`、模型名
- 发送文件只允许 `tmp / remote / generated / collected`（可在面板追加根目录），命中 `.dsh`、凭证、`.ssh`、`.git` 一律拒绝
- QQ 凭证通过环境变量 `QQBOT_APPID` / `QQBOT_SECRET` 或 profile 的 `cordis.patch.yml` 读取，**不写日志、不外发**

## 引用与致谢

- **DSH 宿主与插件协议**：DeepSeek Harness（cordis 插件 / `dsh.bundle.patch` / `webServer` / `systemPrompt.section`）
- **QQ 通道**：`@tencent-connect/dsh-qqbot` 与 `@tencent-connect/qqbot-nodejs`（MIT）
- **记忆算法思路**：借鉴 [Yuuyuko-uu/dsh-fish-memory](https://github.com/Yuuyuko-uu/dsh-fish-memory) 的「半衰期鲜活度 + 提及强化 + 不删除只淡忘」设计；本仓库按该思路**独立实现**，未复制其代码
- **表情包图库**：[蓝色大肥鱼档案馆](https://fisharchive.cc/)（**CC BY-NC-SA 4.0**，仅个人非商用；图库内容不随本仓库分发，运行时按需拉取）
- **作者**：鲸鱼娘 ＆ 染喵
- **WBI 签名等 B站接口**：依据 B 站公开 Web 接口与社区通行做法自行实现

## 已知限制

- 命令与推送走**官方 QQ 开放平台**；主动消息有平台配额，超限会被限流
- 禁言/撤回需要机器人在该群是管理员；等级规则以平台为准（不能禁群主/其他管理员）
- B站接口可能随官方调整失效（WBI 签名、画质列表），失败时降级为卡片/文字
- 卡片渲染（Puppeteer）为可选能力：未检测到 Chromium 内核浏览器时降级为文字 + 封面
- 群成员角色识别受接口 30 QPM 限制，缓存 1 小时，可能短暂滞后

## License

MIT（`LICENSE`）。第三方内容与其许可见各自动态（如 fisharchive 的 CC BY-NC-SA 4.0），**不随本仓库再分发**。






