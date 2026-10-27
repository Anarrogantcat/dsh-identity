# 下个会话从这里开始（2026-10-26 21:0x 状态）

> 目标：按《完整方案》把插件做完（NapCat 主线 / 单活切换 / **不依赖任何其他 DSH 插件** / 单群 / 体验优先）。

## 0.0 版本 0.6.0（2026-10-26 22:1x）

- 新增 `lib/downloads.js`：语音资源下载中心（whisper small 466MB / base 142MB / ffmpeg 80MB），面板「语音」页卡片可下载/删除/一键写 `stt.command`
- 数据目录可整体挪盘：`QQBOT_REFINE_HOME` 环境变量 > 默认目录下 `.data-path` 指针 > 默认；`scripts/move-data.ps1` 一键搬
- 大文件目录单独可配：`paths.downloadsDir`
- 测试新增 `downloads-test.mjs`（20 例，含本地 HTTP 真下载）

## 0.1 全面自检结果（2026-10-26 22:4x，v0.6.2）

| 检查项 | 结果 |
|---|---|
| 全部 js 语法 + panel 内联脚本 | ✅ |
| import/export 对齐（含 class 导出） | ✅ 无缺失 |
| FIELDS / TABS / select options | ✅ 201 字段 · 16 页签 |
| 面板引用的 STATE 键是否都由服务端提供 | ✅ |
| panel 静态 id 重复 | ✅ 无（108 个） |
| 插件在假宿主里 apply 冒烟 | ✅ 0.6.2 / 201 字段 / 15 能力位 / 订阅 session 事件 |
| 全量测试 | ✅ 64 文件 / 554 用例 |

本轮修掉的真问题：
1. **媒体发送失败被吞**：`sendImage/sendVoice/sendVideo` 失败不抛错 → 表情的「回落本地下载」永远不触发（这就是那 2 条发送失败的来源）；现在失败会抛，sticker 会回落本地。
2. 版本号不一致（package 0.5.0 / index 0.6.0）→ 统一 **0.6.2**。
3. 心情评估「全 0」被当解析失败（审计里 471 条）→ 现在算「无变化」。
4. 叫名字判定：把「大肥鱼的图」当叫她了 → 现在区分「称呼」与「话题」。
5. 面板「常用」卡重复渲染、毛玻璃过重导致卡顿 → 去重 + 默认关 + 模糊减半 + 状态未变不重绘。
6. 一条消息里重复占位符（[图片][图片]）→ 合并。
7. 发送失败现在写审计（`onebot.sendFail`，带动作与报错原文）。

已知未做（记着）：`set_qq_avatar` 只验证了接口存在（未用真图测）、agent 脚手架要靠选纯聊天预设压。
入站看图已补（0.6.3）：图片 → 宿主 attachment → 图像内容块；`transport.onebot.vision/maxImages/maxImageMB`；模型拒图自动降级。
## 0. 真机现状（2026-10-26 21:5x）

- 通道 **已连上**：mode=onebot / connected=true / health=ok / 能力位 15/15，账号 100000001（鲸鱼娘）
- NapCat：websocketServers 127.0.0.1:3001（Array、上报自身消息关、token 与插件一致）；Yunzai 的 2536 反向连接不受影响
- 白名单已换成真实群号：983577123（九喵、梨落、祈风、鲸鱼娘）；roles.owners = 100000002（染喵）
- 旧 openid 数据已归档：storages/dsh-qqbot-refine/backups/openid-2026-10-26T13-44-33/（记忆 4 份等 7 个文件）
- 画像已按名册重建 4 人（群名片 + 角色，统计从 0 开始）
- 待重启生效的最后一轮改动：profile.seedMembers / speedCard 用群名片 / 面板「清理旧通道条目」

## 1. 一句话状态

**S3–S7 全部落地（代码 + 测试）**，全量 **59 个测试文件 / 498 条用例全绿**；只剩**真机联调**没做
（NapCat 的 `websocketServers` 还是空的，3001 未监听 —— 用户说自己连）。

> **重启前最后状态（2026-10-26 21:20）**：后台回归任务已全部停止（不占端口/不吃 token）。
> 最终回归：**59 个测试文件 / 58 通过 / 0 失败 / 1 超时**（`media-dl-test` 要访问外网图床，超时属环境问题；单跑多数时候是绿的）。
> 代码提交 `bcaccb7`；`settings.json` 仍是 `tencent` 模式，重启不会改变行为。

## 2. 已完成（逐条对方案 §7）

| 阶段 | 内容 | 状态 |
|---|---|---|
| P0 | 安装恢复、标记泄漏、启动自检 | ✅ |
| S1 | 通道抽象、15 项能力位、官方/onebot 单活 | ✅ |
| S2 | **自建 OneBot 通道**（零插件依赖）+ 名册 + `#群列表`/`#群成员` | ✅ 代码层面，联调待做 |
| S3 | 撤回不答 / 戳一戳 / 合并转发展开 / 引用原文 / 表情回应 / 成员变动 / 可选 STT | ✅ |
| S4 | 引用回复 / 定时撤回 / 视频·文件·语音 / 群管（禁言·解禁·踢人·名片·撤回）/ 贴表情 `#赞` | ✅ |
| S5 | 安全档位 safe·normal、3 次失败熔断 30 分钟、被踢摘白名单、被禁言自动闭麦、onebot 真实用量、赛程 provider | ✅ |
| S6 | 通道页（连接卡 + 健康度 + 能力位清单 + 测延迟）、知识库页、赛程页、名册卡、常用区收纳、话题小卡、按钮语义 | ✅（面板 UI 由第三条鱼落地，见 §5） |
| S7 | 四张认知卡（在场的人 / 说过答应过 / 还没答完的 / 群里最近在聊）、关系图、离线巩固、待办自动补一句 | ✅ |

小债处理：`ignoreSelf`、`mergeWindowSec`、`burstWindowSec/Count+backoffSec`、`auditDays`、`muteTemplate`、`knowledge.injectChars` 已真正生效；
`mentionPriority` 已删除；其余 16 个占位旋钮在面板上标注「暂未生效，先占位」。

## 3. 关键路径

| 角色 | 路径 |
|---|---|
| **项目目录（唯一开发处）** | `D:\AI\DeepSeek Harness Workspace\dsh-qqbot-refine`（git 仓库：源码 + docs/ + test/ + scripts/，最新 `65a4e59`） |
| 部署目录（DSH 加载） | `C:\Users\user\.dsh\plugins\dsh-qqbot-refine`（**改完要跑 scripts/sync-to-deploy.ps1**） |
| 加载入口 | `profiles/desktop/node_modules/dsh-qqbot-refine`（junction → 部署目录） |
| 数据 | `storages/dsh-qqbot-refine`（relations/ self/ todos/ digest/ topics.json safety.json） |
| 蓝图 | 项目里 `docs/qqbot-refine-PLAN-FINAL.md` |
| NapCat 开服方案 | 项目里 `docs/napcat-ws-server-plan.md` |

> 部署流程：改代码 → `scripts/sync-to-deploy.ps1` → 改的是 lib/* 或 index.js 就重启 DSH，只改 panel.html 刷新页面即可。
> 回归：在项目目录跑 `node test/run-all.mjs`（59 个测试文件）。

## 4. 新增模块清单

```
lib/onebot-channel.js   自建通道（事件 → 闸门 → agent → 发送；会话派生/去重/引用/合并/待办钩子）
lib/onebot-inbound.js   notice 事件分类、合并转发拍平、戳一戳话术、撤回过滤
lib/onebot-client.js    OneBot 11 WS 客户端（含延迟）
lib/admin.js            群管与互动动作（OneBot 专用；官方模式整块跳过）
lib/stt.js              可选语音转写壳（stt.command 模板，{file}/{out}）
lib/safety.js           安全档位 / 熔断 / 被踢记录
lib/relations.js        人物卡 + 关系图
lib/cards.js            自我卡 + 待办卡 + cognitiveBlock
lib/digest.js           离线巩固（每小时 ≤50 字摘要）
lib/hooks.js            通道事件 → 认知/安全模块的接缝
lib/roster.js           名册（群/好友/成员）
lib/capabilities.js     15 项能力位
```

## 5. 面板（S6）

`panel.html` 已扩到约 100 KB：新增「知识库」「赛程」页，通道页有连接卡片 + 能力位清单 + 测延迟，
白名单页有名册卡（刷新 + 从群列表选择），顶部常用区收纳 5 个开关，话题小卡、按钮拆分（重置计数 / 重置花费闸 / 刷新名册）。
`client.js`（右下角悬浮按钮）未改。

## 6. 真机联调（等用户）

1. NapCat WebUI（6099）→ 网络配置 → **Websocket 服务器**：`127.0.0.1:3001` + 随机 token、`messagePostFormat=array`、`reportSelfMessage=否` → 重启 NapCat
2. 面板「通道」页：模式 `onebot`、地址 `ws://127.0.0.1:3001`、token → 重启 DSH
3. 验收清单：面板 connected/health/sessions、@ 一句看回不回、`#群列表`/`#群成员`、`#赞`、引用回复、发一句撤回不答
4. 官方通道保持已装未启用（`transport.mode=tencent` 一行回滚）

## 7. 怎么验证没退化

```powershell
$list = Get-ChildItem $env:TEMP -Filter *-test.mjs
$pass=0;$fail=0;$cases=0
foreach ($t in $list) {
  $env:DSH_HOME = Join-Path $env:TEMP ('dsh-test-' + [guid]::NewGuid().ToString('N').Substring(0,8))
  $out = & node $t.FullName 2>&1
  $cases += ($out | Select-String -Pattern '^OK  ' -AllMatches).Count
  if ($LASTEXITCODE -eq 0) { $pass++ } else { $fail++; "FAIL $($t.Name)"; $out | Select-Object -Last 4 }
}
"files=$($list.Count) pass=$pass fail=$fail cases=$cases"   # 当前 59 / 59 / 0 / 498
```

## 8. 交接提醒

- 改服务端代码必须**重启 DSH**；面板端口随重启变化（当前 GUI 端口 + `/qqbot-refine`）
- **别为了省事去装 dsh-onebot-qq 之类**——用户明确禁止；通道必须留在本插件内
- 玩法参考：`README.md` 的「NapCat 专属能力」「钱与安全」「认知四张卡」「命令」四节
