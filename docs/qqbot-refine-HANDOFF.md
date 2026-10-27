# dsh-qqbot-refine · 交接备忘（全面检查后）

生成：2026-10-26 00:1x
插件：C:\Users\user\.dsh\profiles\desktop\node_modules\dsh-qqbot-refine
数据：C:\Users\user\.dsh\storages\dsh-qqbot-refine
面板：http://127.0.0.1:<DSH端口>/qqbot-refine

## 一、健康检查结果

- 32 个源文件全部 `node --check` 通过；panel.html 内联脚本通过
- settings.json / presets.json / package.json 均可解析
- **28 个测试套件、约 250 项断言全绿**（含集成 11 项、隐私 19 项、工具闸门 8 项、@判定 4 项、频率/挡位/记忆/画像/表情/B站/语音/主动/角色 hint）
- 运行时（最近一次）：钩子 入站/出站 均已挂载；工具闸门 installed=true
- 配置：群=1 私聊=1 owner=1 自然=true 仅@=false 人设=true 记忆=true 画像=true 主动=true

## 二、本轮修掉的关键问题（按发现顺序）

1. **工具闸门劫持 tools.register** → `tool "subagent" is already registered` → 新建会话失败
   - 修法：不再劫持注册通道，只对已注册的真工具（name + parameters）就地包装
2. **画像页整段被删**（UI 重构时切掉了函数）→ 画像页空白
3. **白名单页用 append 渲染** → 切页重复堆叠
4. **@ 判定失效**：全量模式下 @人 变成 `<@member_openid>`，只认 appId 会漏
   - 修法：优先读事件 `mentions[]` 的 `bot:true`；`<@all>` 不算叫她
5. **别名缺「鲸鱼娘」** → 群友叫名字她不接
6. **群管识别依赖 30 QPM 接口** → 改为事件 `author.member_role` 直接采用（0 接口调用）
7. **心情缓存滞后**（同毫秒写入同 mtime）→ 改为不缓存
8. **设置被测试清空** → 新增防误清空保险（真实环境同时清空群白名单+Owner 时拒绝写入）
9. **面板切换**：滚回顶部、工具栏按页签显隐、清空残留输出、hash 路由、记住上次页签、毛玻璃开关

## 三、两个硬限制（不是 bug）

1. **QQ 官方默认只推 @ 消息**。群管理员在机器人资料页开「获取群内全部消息」后才会推 `GROUP_MESSAGE_CREATE`（已开）
2. **语音服务未部署**：`voice.enabled=false`，需克隆 astrbot_plugin_feiyu_voice/server + 下模型

## 四、待办

1. 语音服务部署（约 8-10GB 模型，D 盘有空间）
2. 表情包收集：`attachments` + `msg_elements` 字段已按 SDK 类型核对并修（见第五段）；剩下要在真机确认 `content_type` 实际取值与链接有效期
3. B站推送真机调（`pushEnabled=false`）
4. 开源收尾：repository/homepage、英文 README、npm pack、LICENSE 署名
5. 全量消息下 token 消耗监控（`usage` 页目前是本地计数，未接真实用量）

## 五、交付后复查（2026-10-26 00:1x，补记）

### 发现：真配置被测试夹具覆写（已在群里失聪）

- `settings.json` 的 `scope.groups` 变成 `G1`、`scope.dmUsers`/`roles.owners` 变成 `U1`，
  `perMinute*` 被写成 999、`cooldownGroupSec` 写成 77 —— 是没带 `DSH_HOME` 的临时脚本干的（16:03 那批）
- 后果：审计最后一条是 `privacy.dropScope peer=6EC25148`，真群所有消息在 `gate.js:491` 就被扔了
- 真值（取自 16:00 备份）：群 `6EC25148B7DCD81CDB999EF9D6811D5A`，Owner/私聊 `D011FC68B97C7BFDFDEB69D038482C37`

### 已修

1. 白名单 / 私聊 / Owner 恢复真 openid；限速恢复 12 / 6 / 3，群冷却 90 秒
2. `config.js` 加第二道保险：原本是真实 openid、新配置一个都不认识且全都不像 openid（G1/U1 这种）→ 拒绝写入（`QQBOT_REFINE_FORCE=1` 可强写）。已实测夹具被拒、正常保存放行
3. `ui.markers` 补回 DEFAULTS（之前不在默认里，一次 reset 就永久丢了）
4. 清场：roles-cache 删掉 `G1:*` 3 条；state 删掉夹具闭麦/计数器/seen；`tmp/` 10 个测试图删掉（备份在同目录 *.bak.json）

### 验证

- 全套 28 个测试文件全绿，**且跑完真实 settings.json 哈希未变**（隔离确认）
- 面板 200 / state API 返回 `groups=6EC25148…` `owners=D011FC68…` `pm=12/6/3` `cd=90` `markers=true`
- 有意的改动保持不动：`naturalMode=true`、`chatGear=3`、别名含「鲸鱼娘/鲸鱼」、`persona.enabled=true`

### 顺手改的「附件字段」（待办 2 的地基）

- 入站附件原来只读顶层 `raw.attachments`，**引用/回复消息里的图在 `msg_elements[].attachments`**，之前全漏
- `gate.js` 新增 `collectAttachments()`：两层合并 + 按 `url` 去重（字段按 SDK 类型核对：`content_type` / `url` / `voice_wav_url` / `asr_refer_text`）
- 收集时机从「频率闸之后」提到「白名单之后」：以前只有她决定回这条消息时才收图，现在群里发图就收（仍受 `collectEnabled` / `collectPerGroupDay` / 白名单约束）
- 新增测试 `attach-collect-test.mjs`：msg_elements 图能收 / 同图去重 / 语音不收 / 纯文字不下载 —— 4/4 通过

### 新增：「像人」三件套（lib/humanize.js）

1. **去 AI 排版** `plainChatText()`：去 `**粗**`、`# 标题`、`- 列表`、`>`、行内代码、`[文字](链接)` 只留文字、压空行 —— 群友只看得懂纯文本
2. **分段发** `splitBubbles()`：按句子拆，按「每条大约这么长」均衡装箱，短碎片并回前一句（不会「嗯。」单独飞出去），上限 = `frequency.maxRepliesPerTurn`，只在超过 `frequency.splitMinChars`（默认 40 字）时才拆；余下的条隔 200ms+ 补发
3. **打字延迟** `typingDelayMs()`：`250ms + 字数 × msPerChar`（默认 25ms/字），±20% 抖动，封顶 `typingMaxMs`（默认 2.5s）

- 新配置：`ui.plainText`、`frequency.typingEnabled` / `typingMsPerChar` / `typingMaxMs` / `splitMinChars`（默认全开，面板「频率」「用量」页可调）
- 重入保护：补发分段时置 `extraSends` 标记，不会再被拆一次
- 测试：`humanize-test.mjs`（15 项纯函数）+ `human-outbound-test.mjs`（8 项出站行为）全过；全套 32/32 绿
- **注意**：服务端代码改动要**重启 DSH** 才生效（面板字段也是重启后才出现）

### 人设重写（去「客服味」）

- `lib/persona.js` 的 `DEFAULT_PERSONA` 与 `lib/presets.js` 四条内置全部重写，`textVersion` 2 → 3（旧存档会自动刷新）
- 核心变化：**一般一句、最多两句**；不客套/不总结成文/不罗列/不复读；不用标题列表加粗；不确定就说「好像是」；被认真问是不是 AI 就老实承认
- 刻意**不在人设里引用客服禁语原文**（「希望有帮助」这类）——写进提示反而会诱导它说出来；改成正向规则
- 群里默认生效的是 `feiyu-group`（`presets.json` 的 `byGroup` 指向它），所以群聊看到的是新版短句人设
- 测试 `persona-human-test.mjs`：29 项（禁语、节奏、AI 边界、长度、迁移落盘）全过

### 心情整合（dsh-feiyu-mood）

- 新增 `moodToneOf()`：分数 + 维度 → 5 档语气，每档带 **3 条具体行为**（不是一句空话）：
  - 松快（≥70）：可以多说一句、主动接梗、被夸别硬绷
  - 平和：正常一两句、不主动开新话题
  - 有点闷（<45）：只答问到的、不接梗、不说教
  - 低落（分数低 / sad·heartache 高）：一句话说完、不卖萌不撒娇不讨夸、不诉苦
  - 别扭（jealous 高）：勉强答应但要嘴硬一句、句子短带刺、说完就停
- 渲染统一走 `moodBlock()`（唯一一处，避免 index.js 和面板格式漂移），末尾固定一句「心情只改语气和话的长短，事实、边界和安全规则照旧」——心情不能压过安全线
- 测试 `mood-tone-test.mjs`：19 项（5 档识别、每档 3 条行为、五档行为互不相同、三条边界规则）全过
- 新增 `proactiveFactor()`：心情 0→0.4x、100→1.6x，用在主动搭话的随机闸上（`integration.moodProactive`）
- 人设段自动追加：`# 这会儿的心情\n88/100（松快）：语气轻快…口癖可以带「嘿嘿」「呀」「啦」`（`integration.moodInPrompt`）
- 面板 state API 多返回 `mood`（分数/档位/维度/摘要），只读展示
- **隐私边界**：只注入数值和语气建议，**不带** `lastReason` / `lastInjectedText`——那是主会话里聊的具体事，群里是公开场合
- 已有联动保持：表情包 `[[sticker:auto]]` 按心情选情绪、自然接话概率按心情缩放、语音风格 cute/gentle
- **总开关语义**：`integration.linkMood` 是总闸，关掉后 5 个消费方全失效（人设语气 / 接话概率 / 主动搭话 / 表情情绪 / 语音风格），下面 4 个子开关仍保留；面板已把这些子开关从「更多设置」提到常用区
- **过期保护**：心情文件 `updatedAt` 超过 24 小时 → `stale=true`，语气不注入、概率/主动倍率回落 1、语音不挑风格（防 dsh-feiyu-mood 停止运行后她一直冻在旧情绪）
- 测试 `mood-switch-test.mjs`：14 项（总开关、子开关、过期回落、面板字段）全过
- 测试 `mood-persona-test.mjs`：12 项全过

### 会学习（lib/learn.js，全本地 0 token）

两项学习，都写在 `<store>/learned.json`，不联网、不调模型：

1. **纠错学习**：群里 Owner / 管理员说「不要…」「记住…」「叫我…」→ `extractRule()` 抽成规矩存进本群
   - 普通群友说了不生效（防刷屏乱教）；同意思再说一次会覆盖旧的（`ruleKey` 归一化「再/老是/总是」）
   - 每组最多 20 条，注入时只取最后 5 条 → `# 这个群学到的规矩（照做，别念出来）`
   - 开关 `learn.enabled` / `learn.injectRules`
2. **反馈学习**：她说完 → `markSent`；3 分钟内有人接 → `markReacted`；算出回应率
   - `adaptiveFactor()`：样本 ≥10 才生效，回应率 0 → 0.6，50% → 1.0，100% → 1.4
   - 这个倍率**乘进自然接话概率**——没人搭理的群她自动变安静，热闹的群她更活跃
3. 面板 state API 多返回 `learn`（每个 peer 的规矩数 / 发言 / 被接 / 倍率）

- 测试：`learn-test.mjs`（19 项：抽规矩、覆盖、上限、3 分钟窗口、倍率边界）+ `learn-e2e-test.mjs`（7 项：Owner 教得动、群友教不动、出站记数、人设注入、开关生效）全过
- 已知边界：不会自己总结「这个群喜欢什么风格」——那需要模型归纳，走 `profile.llmInduce` 那条路，默认关

### 真实用量 + 金额（lib/usage.js）

- 数据源：`<DSH_HOME>/storages/session_projcache/sessions/<sessionId>.json` → `record.rows.tokenUsage.val.totals`
  （`uncachedInputTokens` / `outputTokens` / `cacheReadTokens` / `cacheWriteTokens`）
- QQ 会话 id 用 `sidFor(appId, scope, peer)` 现推（和 dsh-qqbot 的 `sessionKey=qqbot:appId:scope:peer` + sha256 完全一致，已用真会话文件核对）
- 这些 totals 是**累计值**：当天第一次读时把累计值钉成基线（`storages/dsh-qqbot-refine/usage.json`），今日花费 = 当前 − 基线；**基线不会随每次读取推进**（否则每刷一次面板就清零）
- 金额 = 未命中输入×2 + 命中输入×0.2 + 输出×3（元/百万 tokens，默认 DeepSeek 公开价，面板可改 `usage.priceInputMiss/Hit/priceOutput`）
- 面板「用量」页现在显示：今日花费（超预算标记）、今日预算与占比、今日 tokens 拆解、本会话累计、单价、每群明细；`#用量` 命令也带一行金额
- 新配置：`usage.groupDailyYuan`（默认 3 元/群）、`usage.userDailyYuan`（默认 1 元/人）
- 已知口径：①「今日」从当天第一次读取开始算（重启/零点后重置）；②会话被 fork/归档换 id 时，旧会话的当日花费不计入
- 测试 `usage-cost-test.mjs`：15 项（单价折算、sid 一致性、日增量、超预算、面板行、重置）全过

### 心情：新增独立页签 + 本地兜底引擎

- **新增「心情」页签**（`TABS` 加 `['mood','心情']`），原来挂在「用量」页的 5 个 `integration.*` 字段全部挪过来；页签顶部是一张只读卡片：
  分数 / 档位 / 来源（第三方 or 本地）/ 更新时间 / 维度条（开心·平静·甜·心疼·担心·难过·吃醋）/ 「现在会这样说话」三条 / 刷新 / 重置本地心情
- **心情来源可切换** `integration.moodSource`：
  - `auto`（默认）插件新鲜（24h 内）就用插件，否则回落本地
  - `plugin` 只用 `dsh-feiyu-mood`（过期就按过期处理，不注入语气）
  - `local` 完全不用第三方，只用本地引擎
- **本地兜底引擎** `lib/moodlocal.js`（0 token）：夸/谢/厉害 → +1~+6，笨蛋/废物/滚 → -1~-6；单条最多 ±6；分数朝 50 以 24 小时半衰期衰减；存在 `storages/dsh-qqbot-refine/moodlocal.json`
  - 取舍：只有总分没有 7 个维度，判断靠关键词，不会像第三方那样给出「为什么」的心情理由
- 面板「重置本地心情」走 `mgmtOp kind=mood op=resetLocal`
- **本地心情 v2（像人）**：不是一根分数条，而是 7 维情绪 + 评估 + 惯性 + 半衰期
  - 评估 `appraise()`：夸（谢谢/厉害/靠谱）→ 开心+甜；撒娇（可爱/抱抱/喜欢你）→ 甜；被怼（笨蛋/废物/滚）→ 难过、开心掉；有人倾诉（累/emo/想哭）→ 心疼+担心；被点名 → 甜；紧急（救命/来不及）→ 担心；按身份加权（Owner 1.2 / 管理 1.0 / 群友 0.7）
  - 互动结果也进心情：她说完有人接 → 开心+、担心−；上一句没人理 → 难过+、担心+；0–5 点消息 → 平静+
  - 惯性：**单个维度一次最多 ±2**，不会一句话翻脸；半衰期按维度不同（吃醋 3h、开心 6h、担心/甜 8h、平静/难过 12h、心疼 24h）
  - 分数是**结果**：`50 + 3·开心 + 2·甜 + 1·平静 − 3·难过 − 2·担心 − 2·心疼 − 3·吃醋`，夹在 0~100
  - `learn.markSent()` 现在返回「上一句有没有人理」，gate 出站据此记一次「被冷落」
  - 测试 `mood-human-test.mjs` 16 项（多维评估、惯性上限、各维度半衰期、互动反馈、公式与边界、无记录为 null）全过
- 测试 `mood-source-test.mjs` 15 项（auto/plugin/local 三态、过期回落、±6 上限、24h 衰减、页签与字段落位）全过；旧 `mood-switch-test.mjs` 已按新语义更新（+1 项「插件过期但 auto → 本地顶上」）

### 模型评估心情（已开启，有预算闸）

- `lib/moodllm.js`：群里攒够 `integration.llmEvery`（默认 20）条消息 → 调一次宿主模型，让它给七维情绪增量 + 一句理由
- 输出契约：严格 JSON `{"happy":.. ,"sad":.. ,"reason":"…"}`，每项夹在 ±2；解析失败**不改心情**、只记失败原因
- 增量同样受「单维一次 ±2」的惯性约束（走 `moodlocal.applyDimDelta`）
- **预算闸**：`integration.llmDailyTokens`（默认 20000 tokens/天 ≈ ¥0.04），用完当天不再调，次日自动恢复；token 按「字符数 / 1.6」保守估算
- **理由只落盘给面板看**（`moodllm.json` + 审计 `mood.llm`），**不进 QQ 提示词**——群里说过的具体话不能顺着心情漏出去
- 当前配置：`llmEnabled=true`，provider `deepseek-account`，model `deepseek-flash`，每 20 条一次，20000 tokens/天
- 面板「心情」卡片会显示：今日评估次数 / 已花 tokens / 最近理由 / 上次失败原因
- 测试 `mood-llm-test.mjs` 18 项（JSON 解析与夹紧、坏输出、预算耗尽、无 provider、模型抛错、理由不进提示词）全过

### 看图（QQ 图片）——根因与补丁

- **现象**：群里发图，她回「图没加载出来，只看到链接」
- **根因**：本机系统 DNS 被代理改成 fake-ip（`dns.getServers()` = `fdfe:dcba:9876::2 / 198.18.0.2 / 192.168.1.1 / fe80::1`），
  Node 的**纯 DNS 查询**（`dns.resolve4`）对 qq 域名整域 ESERVFAIL；而 `dns.lookup`（getaddrinfo）正常。
  qqbot 插件的 SSRF 检查 `assertSafeHostname()` 只用 `resolve4` → 抛错 → 附件下载被静默跳过 → 模型只拿到 URL。
- **补丁**：`node_modules/@tencent-connect/dsh-qqbot/dist/transport/attachment.js` 的 `assertSafeHostname()`
  增加「resolve4 失败 → 回落 `dns.lookup`（仅取 IPv4）」；备份在同目录 `attachment.js.bak-refine`
  - 实测：下载 439KB 成功落盘到 `~/.dsh-qqbot/media`；内网地址仍被拦（`SSRF blocked: 127.0.0.1`）
  - ⚠️ 该文件在 `node_modules`，**qqbot 插件升级会覆盖**，升级后要重新打
- 配套改动：`cordis.patch.yml` 的 im-qqbot 块加 `media`（50MB/24h）+ `vision`（deepseek-account / deepseek-flash / 中文 prompt）；
  成员工具白名单加 `read_image` `qqbot_describe_image`；工具闸门把 `~/.dsh-qqbot/media` 视为工作区

### 看图已打通（2026-10-26 01:5x 实测确认）

- 群里发图后她真的看到了：`27分钟 iG 24比9、经济领先5k，Kanavi 0/5/3` —— 说明 下载 → 本地路径 → vision → 回答 整条链通了
- `~/.dsh-qqbot/media` 里有 `3466KB` 的截图文件（之前是空的，验证点就是这里）
- **顺手修的安全洞**：`toolgate.decide()` 里 `name` 在 `const name` 声明之前就被引用（TDZ），抛出的 ReferenceError 被外层 catch 当成「闸门自己出错」静默放行 →
  也就是说**越界路径的拦截一直是失效的**（只是没人触发）。已把声明提前，测试断言「System32 路径被拒」
- **看图成本闸**（图片很贵）：
  - 同一张图 30 分钟内不重复看（按路径去重）
  - 每组每日看图上限 `tools.imagePerGroupDay`（默认 20，0=不限）
  - 超限回一句「今天看图次数到上限了」，不花 token
- 测试 `toolgate-image-test.mjs` 7 项 + 全套 48/48 全绿

### 数据层现状（2026-10-26 01:5x 盘点）

| 库 | 量 | 说明 |
|---|---|---|
| 表情包 | 279（271 远程 + 8 收集） | 收集图 **没有 mood** → 永远选不中（待修） |
| 记忆 | 4 个 peer / 17 条 | 半衰期衰减 |
| 画像 | 2 个群（4 人 / 2 人） | 每日归纳 |
| 规矩 | 0 条 | 还没人教过她 |
| 本地心情 | 79 次事件 | 七维 |
| **知识库** | 新建 | `storages/dsh-qqbot-refine/knowledge/*.md` |
| **赛事库** | 新建 | `matches.json` |

### 赛事数据源实测（都试过）

- **Leaguepedia Cargo API**（`lol.fandom.com/api.php`）：结构可用，但本机出口 IP 被限流 → `{"error":{"code":"ratelimited"}}`
- **官方 lolesports API**（`esports-api.lolesports.com/persisted/gw/getSchedule`）：公开 key 已 **403**
- **结论**：不接第三方赛事 API，改成「**本地赛事库 + 模型 web_search**」

### 新增：本地赛事库（lib/esports.js）

- `matches.json`：`{date, league, team1, team2, score, winner, note}`，同一天同两队自动覆盖
- 命令（0 token）：`#赛程` 列表 / `#赛程 IG` 按队搜 / `#交手 IG HLE` 交手记录 / `#赛程 加 2026-10-26 IG 2:1 HLE Worlds`（仅 Owner/管理）
- 空库时文案老实说「本地还没有记录」，不编

### 新增：群知识库（lib/knowledge.js）

- `knowledge/common.md` 所有群共享；`knowledge/g_xxxxxxxx.md` 只对该群生效
- `chunkMarkdown()` 按 `#`/`##` 切块（单块 ≤700 字）；`searchKnowledge()` 中文二元 + 英文词重叠，**标题命中 +0.2**，阈值 0.22
- 注入：人设段按「最近一条群消息」检索，命中才追加 `# 这个群的资料`（上限 400 字，`knowledge.injectChars` 可调）
- 命令：`#知识` 列标题 / `#知识 关键词` 直接查（0 token）
- 测试 `esports-kb-test.mjs` 14 项全过；全套 49/49

### 收集来的 9 张「表情」其实是截图（已处置）

- 逐张看过：全是 **LoL 比赛截图 / 直播间 UI / 鲸鱼娘资料卡**，没有一张是表情
- 处置：标 `sendable:false` + `tags:['截图']`（留在库里备查，但不会被选中发送）；清掉 1 张损坏文件（2KB）
- **根因修复**：`collectSticker()` 现在先看尺寸——`looksLikeSticker()` 用 sharp 读元数据，
  最长边 > `sticker.collectMaxPx`（默认 640）或长宽比 > 2.4 的一律当截图不收
- 表情池现状：279 条 / **有 mood 可发送 270** / 收集 8（全部标记不可发送）

### 知识库已填内容

- `knowledge/common.md`：群命令表、术语（白饭/本鱼/小名）、常见问题（为啥不回、能不能看图、会不会泄露配置、记忆能不能删）、项目定位
- `knowledge/g_6ad5415839a9.md`：本群约定（称呼、发图、语气）
- 检索实测：`怎么闭麦`→群命令(0.5)、`白饭是什么`→术语(0.33)、`能不能看图`→常见问题(1.0)、`比赛截图能看吗`→发图(0.67)、`今晚吃什么`→无命中（已加停用词过滤）

### 开源收尾（release/dsh-qqbot-refine）

- 目录：`D:\AI\DeepSeek Harness Workspace\release\dsh-qqbot-refine`（41 个文件已 git 提交 `48e1e15`）
- `package.json`：版本 **0.3.0**、`private:false`、files 含 README.en.md、keywords 扩充
- 新增 `README.en.md`（英文）、`.gitignore`；LICENSE 为 MIT，署名「鲸鱼娘和染喵」
- `npm pack --dry-run`：40 个文件 / 117.6 kB / 解包 344 kB
- ⚠️ 还需你填：`repository` / `homepage` / `bugs` 三处现在是 `your-github-name` 占位

### 修复：模型评估心情空转（11 次调用 / 2524 tokens 全废）

- 现象：`moodllm.json` 里 `calls:11, tokens:2524, lastError:"模型输出不是 JSON"` —— 一次都没解析成功
- 根因：模型经常带解释/代码块/中文引号/数字带引号/尾逗号，原解析只认「纯 JSON 且花括号包裹」
- 修法（`lib/moodllm.js`）：
  1. 提示词改成「**只输出一行 JSON**，不要前言、不要代码块」
  2. 解析容错：剥围栏 → JSON.parse → 中文引号/尾逗号修正 → 仍失败则**正则抠** `happy: 1.2` 这类写法（reason 也支持无引号）
  3. **熔断**：连续 3 次解析失败就当天暂停（不再烧 token），成功一次清零；面板可「重置熔断」
  4. 诊断：保留 `lastRaw`（原始输出前 200 字），面板心情卡直接显示
- 已把真实 `moodllm.json` 的 failStreak/lastError 清掉，重启后重新试
- 测试 `mood-llm-parse-test.mjs` 15 项全过（8 种真实畸形输出 + 熔断/恢复）；全套 **50/50**
- release 仓库同步提交：`bfedd4b`

### 修复：不能连续对话（频率闸互相打架）

- 现象：群里叫她「大肥鱼说说你的分析」，她不接；连续聊天一两句就断
- 代码里三处互相打架：
  1. `selfGapSec`（她说完静默 20s）的检查**在「叫小名」判定之前**——刚说完 20 秒内，谁叫都不理
  2. Owner 的消息不走自然模式分支 → `sampled` 恒为 false → 落到 **90 秒群冷却**（`cooldownGroupSec`）
  3. 自然接话还有 `naturalCooldownSec` 120s / 每小时 8 次 / 每天 30 次 三道闸
- 修法（`lib/gate.js`）：
  - 新增 `directed = @她 || 叫小名 || 接续对话`；**directed 一律绕开 selfGap、自然三道闸、群冷却**，只受「@ 冷却」（默认 0）
  - **接续对话**：记录 `replyTo`（她这次在回谁）；同一个人在她回话后 `chainWindowSec`（默认 120 秒）内接着说 → 当成还在跟她聊
  - Owner 不再因为是 owner 就掉进群冷却分支
  - 每分钟/每人上限照旧生效（防刷屏）
- 测试 `chain-test.mjs` 7 项全过（连续对话放行 / 换人闲聊挡 / 点名放行 / 冷却期内点名放行 / 窗口过期失效 / 每分钟上限仍生效）；全套 **51/51**
- release 仓库同步：`73f4793`

### 话题/赛程：只认赛程库，不从聊天猜（按用户要求重做）

- 上一版从聊天文本里认「A vs B」→ 会串场（聊上一场、她在聊下一场），而且会把选手外号当队名
- 现在（`lib/topic.js`）：
  - **事实来源只有两处**：`matches.json`（权威）+ 模型 `web_search` 写入的记录（带 `source`）
  - 聊天只做「指认」：**队名与库里记录一致**才认为在聊这场；对不上就**不说话，改成问一句**
  - **选手外号黑名单**（Kanavi/TheShy/Zeus/Rookie/Gumayusi/Delight/369…）永不当队名
  - 库里今天没有记录时，注入明说「别自己指定是哪一场，先问清或去查」
- 已种一条真实赛程：`HLE vs IG｜Worlds 2026 瑞士轮｜比分待补｜source=web_search`
- 人设也加了一条：分不清之前那场/今天这场就先问；不许拿外号凑对阵
- 测试 `topic-db-test.mjs` 10 项全过；全套 **53/53**

### 2026-10-26 20:0x 进度：P0 完成 + S1 完成 + S2 部分

**P0（已完成）**
- 发现插件被 pnpm 隔离进 `node_modules/.ignored`（profile 未声明依赖）→ 源码搬到 `~/.dsh/plugins/dsh-qqbot-refine`，profile 声明 `file: 依赖`，node_modules 用 junction 指回
- `diag.js` 的 SDK 定位修复：插件不在 node_modules 里时，也会去 `profiles/desktop|web/node_modules`（含真实 home 兜底）
- 修**标记泄漏**：此前只判 sticker/remember，`[[voice:]]`/`[[recall:]]` 单独出现会原样发到群里；现在任一标记都剥离并计入计数
- snapshot 增加 `install` 自检（inIgnored / viaNodeModules），版本升到 0.3.0

**S1（已完成）**
- `lib/capabilities.js`：双模式能力位（15 项）+ `guardCap` + `capabilitySummary`
- `lib/transport.js`：单活通道（tencent | onebot）+ `describe()`（含 health）
- `lib/onebot-client.js`：OneBot 11 WS 客户端（API/事件/重连/状态）
- `lib/roster.js`：群/好友/成员缓存（名片优先、角色聚合、节流由调用方控制）
- config：`transport.mode / onebot.url / onebot.token / rosterRefreshHours` + 新「通道」页签（4 字段）
- index：通道启动、名册定时刷新、state 暴露 `transport / capabilities / roster / groupChoices / groupNames`

**测试**：56/56 全绿（新增标记泄漏 5 项、能力位+名册 14 项）；onebot 模式启动冒烟通过（未连上也不崩，日志打印 `[capability] mode=onebot 可用 15/15`）

**进度提交**：release 仓库 `f81a9f3`

**下一步（S2 剩余 + S3/S4/S5/S6/S7）**
- S2 剩余：把消息流接进 dsh-onebot（包 `ChatBridge` 或等它放 hook），目前 onebot 侧只做到"能连、能调 API、能收事件"
- S3/S4：撤回/戳/转发/表情/引用/语音/文件/群管
- S5：真实用量映射（`chat-sessions.json` → projcache）+ 安全模式/熔断
- S6：面板通道页/知识库页/赛程页/名册卡片
- S7：四张认知卡

### 留意

- `frequency.quietEnabled` 现在是 `false`（深夜测试方便）。正常用建议改回 `true`（23:30–08:00 免打扰）
- usage 页的「用量」是闸门计数器，不是模型计费；接真实 token 用量要先确认 DSH 侧有没有对插件可见的 usage 事件

## 六、常用操作

- 重启 DSH 后端口会变，面板地址用当前 GUI 端口
- 群命令：#帮助 / #群状态 / #闭嘴 / #说话 / #表情 / #B站 / #绑定（绑定码）
- 测试：%TEMP% 下 30 个 .mjs；**必须带 DSH_HOME 临时目录**，否则可能动真实配置
- 配置备份在 storages/dsh-qqbot-refine/backups/（自动保留 20 份）
