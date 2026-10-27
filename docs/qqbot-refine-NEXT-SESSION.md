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
| 充值码专用浏览器 | `storages\dsh-qqbot-refine\pay-browser`（登录态，别删）+ `scripts/pay-browser.ps1`（CDP 9333） |
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

### 0.10.0 修掉的事（2026-10-27 深夜）

| 问题 | 处理 |
|---|---|
| 价格默认值不一致（config 0.2/3 vs usage 0.04/8） | `DEFAULTS.usage` 统一成 **2 / 0.04 / 8**，并加了断言测试 |
| 空闲价只能靠系数、`holidays`/`peakOnlyWeekdays` 没面板入口 | 新增三个显式空闲价字段（留 0 = 按系数）+「周末算空闲」开关 + 节假日列表；结算改成峰谷各用一套价；面板/管理表/`#用量` 都分开显示 |
| `#余额` / `#充值` / `#充值码` 一执行就 ReferenceError（`gate.js` 压根没 import `meal.js`） | 补上 import；顺带做了充值流水、每人每日上限、60 秒防重复、`#饭账`、无金额时的用法提示 |
| 群成员完全用不了 dsh-computer-use-win | 新增 `tools.computerUse`（off / read / full，默认 read）；工具名认 `mcp__server__` 前缀和 `*` 通配；QQ 会话建好后就地挂闸门（`gateAgent`） |
| 主动搭话的 hybrid / llm 模式永远回落模板（`proactive.js` 没用 `collectStream`，也没 import） | 补 import；`hybrid` 里 `prov/model` 未定义的老坑一并修掉，测试从「静默失败」改成 exit≠0 |
| **「连续对话」判定太松**：只要她处理过这个人的上一条，同一个人的下一句就被当成接续，绕过一切自然接话判定 → 群里一直插嘴、白烧 token | 现在必须**她真的发过话**（`lastSpoke` 在窗口内）才算接续；`judge` / `natural` / `nm` / `gear` / `mention-raw` 五个测试一起转绿 |
| 命令卡片在 `DSH_HOME` 被改写时画不出来（只找临时 profile 的 sharp） | `getSharp()` 再兜底真实 `~/.dsh/profiles/*/node_modules`；`finish-test` 的 B 站卡片恢复 |
| 21 个老测试打印 ❌ 却从不设退出码 | 全部补 `process.exitCode`，`run-all` 的绿灯现在可信；`persona3/persona4` 的文案断言按现版本更新 |
| 想让 `#充值码` 发**真实当次**的充值二维码 | 新增 `lib/payqr.js`：CDP 驱动专用 Edge（`scripts/pay-browser.ps1`，登录态在 `storages/…/pay-browser`）→ 选金额/方式 → 点「去支付」→ 截 `.ds-qr-code`；配置 `usage.payLive*`；失败回落静态码 |

> 测试坑（本轮已清）：`run-all.mjs` 只按 exit code 计数，之前 24 个老测试从不设 `process.exitCode`，
> 打印 ❌ 也算「通过」。现在这些测试都补了退出码，`voice-test` 缺 silk 时明确跳过。

## 7. 回归（本轮）

```powershell
cd 'D:\AI\DeepSeek Harness Workspace\dsh-qqbot-refine'
node test/run-all.mjs
```

本轮结果（2026-10-28 02:xx，v0.10.0，约 10 分钟）：

```
测试文件：101  通过：101  失败：0      # 断言 1102 条，❌ 0 条
```

注：`test/run-all.mjs` 只是入口，不算用例文件；目录里现在是 102 个 `.mjs`（101 个测试 + 1 个入口）。
`media-dl-test`（连外网图床）和 `voice-test`（缺 silk-wasm 时自动跳过）都不会再拖红。

**这次绿灯是真绿灯**：`run-all` 只看 exit code，所以给 21 个「打印 ❌ 但不设退出码」的老测试
全部补了 `process.exitCode`。之前那 22 条内容级失败也都清了：

| 症状 | 真正的原因 | 怎么修 |
|---|---|---|
| judge / natural 里「闲聊→不接」失败 | 「连续对话」要求太松（她没说话也算接续） | `gate.js` 的 continuation 要求 `lastSpoke` 在窗口内 |
| nm 的「4-5 条不回」「第 7 条不回」 | 同上 | 同上 |
| gear 的三道上限失效 | 同上（同一人连发被当接续） | 同上 |
| mention-raw「@别人→不接」 | 同上 | 同上 |
| finish 的 B 站卡片渲染失败 | 测试把 `DSH_HOME` 指到临时目录，找不到 profile 里的 sharp | `getSharp()` 兜底真实 `~/.dsh/profiles/*/node_modules` |
| persona3 / persona4 文案断言 | 人设文本已改版（v7），测试还在查旧词 | 断言换成现版本的说法，长度上限放宽到 1200 |

## 8. 交接提醒

- 改服务端代码必须**重启 DSH**；面板端口随重启变化（当前 GUI 端口 + `/qqbot-refine`）
- **别为了省事去装 dsh-onebot-qq 之类**——用户明确禁止；通道必须留在本插件内
- 改价 / 峰谷窗口：`settings.json` 的 `usage.*`，或面板「用量」页 → 更多设置
- 玩法参考：`README.md` 的「NapCat 专属能力」「钱与安全」「认知四张卡」「命令」四节
