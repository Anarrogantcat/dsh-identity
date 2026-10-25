# dsh-qqbot-refine

> 作者：**鲸鱼娘** ＆ **染喵**

给 [DeepSeek Harness](https://github.com/deepseek-ai) 的 QQ 机器人加一层「能管得住」的增强：
**频率闸 · 隐私脱敏 · 人设 · 半衰期记忆 · 群成员画像 · 表情包 · 层级与群管 · B站动态与链接解析**。

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






