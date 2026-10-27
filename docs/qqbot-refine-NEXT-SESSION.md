# 下个会话从这里开始（2026-10-28 00:xx · v0.10.0）

> 目标没变：按《完整方案》把插件做完（NapCat 主线 / 单活切换 / **不依赖任何其他 DSH 插件** / 单群 / 体验优先）。

## 0. 一句话状态

代码到 **0.10.0**，工作区已提交，**源码与部署目录逐文件哈希一致**。
全量回归 **100 个测试文件**（结果见 §7）。真机通道 **connected / health=ok / 能力位 15/15**，
账号 690618714（鲸鱼娘），白名单群 830148935，`chatMode=mention`（只认 @ / 叫名字）。
本轮三件事：价格体系（默认值 + 空闲价显式字段 + 节假日）、电脑操控（`tools.computerUse` + 会话级闸门）、充饭钱（流水 / 每人上限 / `#饭账`）。

## 1. 0.6.3 → 0.10.0 的增量（按主题）

| 主题 | 版本 | 做了什么 |
|---|---|---|
| 看见图片 | 0.6.3 / 0.9.10 / 0.9.11 | 入站图 → 宿主 attachment → 图像块（模型拒图自动降级）；跟 @ 分开发的图不丢；可借用群里最新那张 |
| 人设与「像人」 | 0.6.4–0.6.6 / 0.7.8 / 0.9.28–0.9.29 | 聊天尺度滑杆（真接线 + 带动她的状态）、人设 v7、不是跟她说话就别插嘴、去 AI 排版、长句拆条、按字数「打字」 |
| 语音 | 0.7.1–0.7.5 | 资源下载进度、语音状态卡、语音服务按需启动（不再常驻 12GB） |
| 认知 / 心情 / 画像 | 0.6.9 / 0.8.1–0.8.2 / 0.9.2–0.9.5 / 0.9.12 / 0.9.20–0.9.23 | 心情页按钮修好 + 熔断自愈；画像分层 + 诊断式归纳；心情真正影响语气；情绪 / 亲密度 / 心情归因；从聊天里自动记事实；只回 thinking 时重试 |
| 模型调用 | 0.6.x / 0.9.3 / 0.9.15 | chunk 解析、content blocks（传字符串 = 空内容的老坑）、留空就用宿主默认模型、provider/model 走 llmroute |
| 生图 | 0.9.6–0.9.13 + 本地 ComfyUI | `#画` / 自然语言触发；先搜 → 出草稿 → 等确认 → 再画；img2img 参考图；生图时语音自动闭嘴 |
| 在线修 bug | 0.9.21 | 诊断 → 贴 diff → 群里确认 → 合并（fix.js） |
| 知识库 | 0.8.8–0.9.1 | 面板里可编辑；导入 pdf / docx / sqlite / html |
| 用量与钱 | 0.8.5 / 0.9.17–0.9.19 / 0.9.29–0.9.32 | 通道计数持久化；缓存放大校准（0.15）；峰谷 + 搜索计价；「她还能吃几碗饭」+ 充饭钱；收款码开关 / 切换 / 从文件夹取最新一张 |
| 安全 | 0.7.7 / 0.9.2 / 0.9.16 | Owner 群内全工具（危险命令仍拦）；每次工具调用写审计；外来内容防注入 |
| 上下文省钱 | 0.9.25–0.9.27 | 自适应群聊上下文窗口；临压缩时多回忆；压缩摘要写回记忆 |
| 分发 | 0.8.x | 包可安装（`dsh plugin add github:...`）、INSTALL.md、仓库公开 |

## 2. 真机现状（2026-10-27 23:2x 实测，来自面板 state API）

- 通道：`mode=onebot` / `ws://127.0.0.1:3001` / `connected=true` / `health=ok` / 重连 0 次
- 能力位 **15/15** 全亮，`missing` 为空
- 账号 690618714（鲸鱼娘）；白名单群 **830148935**，私聊白名单空
- 频率：`chatMode=mention`、概率 20%、`chatGear=4`、`quietEnabled=false`、自然接话 10 次/小时
- 计数：`inbound 4 / blocked 4 / dispatched 0` —— 群里那几条都没 @ 她，符合 mention 模式，不是故障
- 用量价：**2 / 0.04 / 8** 元每百万 tokens，谷时 ×0.5，校准系数 1，搜索 0.005 元/次（2026-11-01 前免费）

## 3. 关键路径

| 角色 | 路径 |
|---|---|
| **项目目录（唯一开发处）** | `D:\AI\DeepSeek Harness Workspace\dsh-qqbot-refine`（git 仓库，最新 `6eb1be7`） |
| 部署目录（DSH 加载） | `C:\Users\Ranmi\.dsh\plugins\dsh-qqbot-refine` |
| 加载入口 | `profiles/desktop/node_modules/dsh-qqbot-refine`（junction → 部署目录） |
| 数据 | `C:\Users\Ranmi\.dsh\storages\dsh-qqbot-refine`（settings.json / roster.json / usage*.json / bond.json / topics.json …） |
| 蓝图 | `docs/qqbot-refine-PLAN-FINAL.md` |
| NapCat 开服方案 | `docs/napcat-ws-server-plan.md` |

> 部署流程：改 `lib/*` 或 `index.js` → `scripts/sync-to-deploy.ps1` → 重启 DSH；只改 `panel.html` 刷新页面即可。
> 回归：项目目录跑 `node test/run-all.mjs`。

## 4. 模块（57 个 `lib/*.js`，按用途分组）

```
通道/传输   transport  onebot-channel  onebot-client  onebot-inbound  capabilities  api
语境/接话   directed  fit  gear  ctxwindow  topic  humanize  persona  presets  learn  automem
认知/画像   profile  relations  bond  memory  mood  moodllm  moodlocal  cards  card  digest  hooks
安全/权限   guard  privacy  safety  roles  permgear  untrusted  toolgate
动作/玩法   admin  sticker  draw  voice  stt  bili  esports  downloads  proactive  meal
用量/运维   usage  cost  diag  fix  mgmt  knowledge  roster  store  state  config  llmroute  llmtext
```

## 5. 面板

`panel.html` ≈ **150 KB**：18 个页签、**242 个字段**（其中 12 个仍标「暂未生效，先占位」）。
重点页：用量（峰谷明细 + 按会话排行）、生图、语音、知识库、赛程、通道（连接卡 + 15 能力位 + 测延迟）。
右下角悬浮按钮在 `client.js`。

## 6. 待办 / 已知坑

1. 12 个占位旋钮仍标「暂未生效」。
2. 真机验收还差：`#赞`、引用回复、撤回不答、`#群列表` / `#群成员`、语音收发、画图确认流。
3. 另外三份蓝图（HANDOFF / FULL-SPEC / MIGRATION-PLAN）仍是 10-26 版，没随 0.9.x 更新。
4. 工具闸门只在**会话创建时**扫一遍该会话的工具容器（`gateAgent`）；MCP 工具是懒加载的，
   如果某个 MCP 服务是会话建好之后才注册进这个会话，需要重新开会话才会被包上。

### 0.10.0 修掉的三件事（2026-10-27 深夜）

| 问题 | 处理 |
|---|---|
| 价格默认值不一致（config 0.2/3 vs usage 0.04/8） | `DEFAULTS.usage` 统一成 **2 / 0.04 / 8**，并加了断言测试 |
| 空闲价只能靠系数、`holidays`/`peakOnlyWeekdays` 没面板入口 | 新增三个显式空闲价字段（留 0 = 按系数）+「周末算空闲」开关 + 节假日列表；结算改成峰谷各用一套价；面板/管理表/`#用量` 都分开显示 |
| `#余额` / `#充值` / `#充值码` 一执行就 ReferenceError（`gate.js` 压根没 import `meal.js`） | 补上 import；顺带做了充值流水、每人每日上限、60 秒防重复、`#饭账`、无金额时的用法提示 |
| 群成员完全用不了 dsh-computer-use-win | 新增 `tools.computerUse`（off / read / full，默认 read）；工具名认 `mcp__server__` 前缀和 `*` 通配；QQ 会话建好后就地挂闸门（`gateAgent`） |
| 主动搭话的 hybrid / llm 模式永远回落模板（`proactive.js` 没用 `collectStream`，也没 import） | 补 import；`hybrid` 里 `prov/model` 未定义的老坑一并修掉，测试从「静默失败」改成 exit≠0 |

> 测试坑：`run-all.mjs` 只按 exit code 计数，而 24 个老测试文件从不设 `process.exitCode`，
> 打印了 ❌ 也照样算「通过」。本轮修了 `hybrid-test` / `voice-test`（缺 silk 时跳过），
> 其余打印 ❌ 的老测试（bili 卡片、频率上限、闲聊不接、persona 文案…）还没动，属于历史债。

## 7. 回归（本轮）

```powershell
cd 'D:\AI\DeepSeek Harness Workspace\dsh-qqbot-refine'
node test/run-all.mjs
```

本轮结果（2026-10-28 00:xx，v0.10.0，约 10 分钟）：

```
测试文件：100  通过：100  失败：0      # 断言 1063 条
```

注：`test/run-all.mjs` 只是入口，不算用例文件；目录里现在是 101 个 `.mjs`（100 个测试 + 1 个入口）。
`media-dl-test`（连外网图床）和 `voice-test`（缺 silk-wasm 时自动跳过）都不会再拖红。

**但这 100/100 只代表 exit code**：还有 22 条断言在 9 个老测试里打印 ❌ 却不设 `process.exitCode`：

| 文件 | 失败项 | 可能原因 |
|---|---|---|
| `finish-test` | B站卡片渲染成功 | 卡片渲染依赖/字体或模板漂移 |
| `gear-test` | 每小时/每日上限、最小间隔 | 挡位默认值和测试假设不一致 |
| `judge-test` / `natural-test` | 闲聊/纯表情/@别人→不接、自然冷却 | 接话判定阈值漂移（会多说话 = 多花钱，值得修） |
| `mention-raw-test` | @别人 → 不接 | 同上 |
| `nm-test` | 4-5 条不回、第 7 条不回 | 自然接话计数漂移 |
| `persona3-test` / `persona4-test` | 嘴硬梗、3 句限制、先结论、字数 | 人设文案已迭代，测试没跟上 |

下一轮优先修 judge / natural / mention（直接关系到「不乱说话」和成本）。

## 8. 交接提醒

- 改服务端代码必须**重启 DSH**；面板端口随重启变化（当前 GUI 端口 + `/qqbot-refine`）
- **别为了省事去装 dsh-onebot-qq 之类**——用户明确禁止；通道必须留在本插件内
- 改价 / 峰谷窗口：`settings.json` 的 `usage.*`，或面板「用量」页 → 更多设置
- 玩法参考：`README.md` 的「NapCat 专属能力」「钱与安全」「认知四张卡」「命令」四节
