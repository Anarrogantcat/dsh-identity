# 身份系统 · 开发流程（v1.12 开工前准备）

> 适用：P0.5 接线审查 → P1 身份核心 → 后续各竖切。
> 本文件是"怎么干"的流程，不是功能方案（方案见 `identity-system-v1.9-layered.md`）。

---

## 0. 硬边界（先立规矩）

1. **仓库是唯一开发处**：`D:\AI\DeepSeek Harness Workspace\dsh-qqbot-refine`
2. **不实装到 DSH**：不跑 `scripts/sync-to-deploy.ps1`、不重启 DSH、不碰 `C:\Users\Ranmi\.dsh\plugins\dsh-qqbot-refine`
3. 线上保持 0.11.2 不动；部署是**最后一步**，必须你明确说"可以上线"才做
4. 方案文档（设计稿）不提交；代码/测试/流程文档可以提交
5. 每轮只做一条竖切，**打通再下一条**

---

## 1. 分支与提交

- `master` 保持"可部署"状态；
- 每个竖切开一个分支：`feat/p0.5-wiring`、`feat/p1-identity` …
- 一个提交只做一件事；提交信息写清"改了什么/为什么/怎么验"；
- 每轮结束：`git status` 干净、测试绿、门禁扫描通过，再合并。

---

## 2. 每轮开发循环（标准动作）

```
1) 选竖切（本轮只做一条）
2) 填接线表：提供者 / 入口 / 写状态 / 读状态 / 策略键 / 额度 / 降级 / 面板 / 测试
3) 写代码（先接口，后实现）
4) 单测（新测试直接 import 仓库源码，不 import 部署副本）
5) 集成/闭环测试（事件→状态→提示词→行为→回写）
6) 门禁扫描（配置/导出/import 环）
7) 面板或命令可见
8) 审计（谁/何时/结果）
9) 文档更新（流程/方案/README 按需）
10) 全量回归（run-all）
```

缺任何一步，本轮不算完成。

---

## 3. 完成定义（DoD）

- [ ] 唯一实现（没有旁路）
- [ ] 至少一个入口（命令 / 自然语言 / 工具）
- [ ] 有策略与额度（能关、能限）
- [ ] 有审计
- [ ] 面板可见或命令可查
- [ ] 有闭环测试
- [ ] 配置项有读取点（无死配置）
- [ ] 导出有使用点（无死代码）
- [ ] import 环 = 0

---

## 4. 测试规范

- 基线：`node test/run-all.mjs`（当前 108 文件 / 1232 断言全绿）
- **新测试 import 仓库**：`new URL('../lib/x.js', import.meta.url)`，不要写死部署路径
- 每个竖切至少：单元 + 1 条闭环 + 1 条降级/失败路径
- 涉及状态写入的：必须测"重复投递/重启/并发"三类
- 涉及钱的：必须测"无确认码/重放/额度耗尽"
- 涉及能力的：必须测"provider 不可用 → 明确报错，不崩"

---

## 5. 数据与迁移

- 迁移只读：复制旧数据 → 新结构，旧文件保留 30 天；
- 每个新状态先写 schema 版本；读到旧版自动升级；
- 全程 feature flag，默认关；出问题一键回退；
- 不删任何不可恢复数据。

---

## 6. P0.5 任务清单（第一轮，✅ 已完成）

已落地：
1. **接线扫描** `node scripts/wiring-scan.mjs`（死旋钮 / 幽灵字段 / 孤儿模块 / 死导出 / import 环；ERROR 非 0 退出）——当前全绿。
2. **现状清单**：13 个「暂未生效」旋钮全部接上（入站媒体/外发文件上限/B站封面与模板/单张表情/@脱敏/丢链接/外链白名单/新人观察/群与个人每日预算/告警比例）；`ctxwindow` 的 `contextLinesFor` 忘记 import 已修（群聊上下文此前被 try/catch 吞掉）。
3. **竖切 1（身份）**：P0 policy/budget/scheduler/events 接进 index/gate 最小路径——消息落盘（ref 幂等）→ 身份段注入 → 回复落盘 → 审计；`event.record` 受策略闸（auto/dryrun/off）。
4. 回归 + 新测试 `test/p05-wiring-test.mjs`（31 断言）。

---

## 7. P1 任务清单（第二轮，✅ 核心完成）

1. ~~内核/风格拆分~~：`lib/identity.js`（KERNEL + SCENES + 4 套风格）；旧 `presets.json` 只读迁移，原文备份 `identity-legacy.md`。
2. ~~traits 存储~~：`lib/traits.js`（复用 `lifecycle.js`：≥3 证据 / 跨 ≥2 天 / 非纯情绪 → durable；90 天过期；Owner 否决）。
3. ~~self 卡迁移~~：只读、按 ref 幂等，备份 `traits-legacy.md`。
4. ~~单一身份注入~~：`qqbot-refine:identity`（≤900 字，身份优先，风格最后裁）＋ `qqbot-refine:context`（记忆/画像/知识/认知/标记）。
5. ~~去依赖~~：删 `agentPresets` 调用与 `transport.onebot.preset`；删 `feiyu-mood` 读取器与 `moodSource`；`presets.js` 删除，`#人设/#身份` 改走风格库。
6. ~~面板「身份」页~~：内核只读 / 风格全局与按群按人 / traits 晋升与否决。
7. 测试：`test/p1-identity-test.mjs`（30 断言）。

---

## 7.5 P2 防压缩/接续（✅ 核心完成）

- 宿主压缩信号已确认：`user/message` 且 `source.kind` 含 `compact`（`onSessionEvent` 本就有这个分支，现在同时置 `needResume`）。
- `lib/resume.js`：接续包 = 身份一句 + 最近 8 条事实（events，按 peer seq 去重）+ durable traits；≤420 字；提交只前进不后退。
- 触发：压缩后、`agents.resume` 恢复会话、上下文压力 >0.75（读 session 文件 `pressureRatioOf`）。
- 测试：`test/p2-resume-test.mjs`（13 断言）。

---

## 7.6 P3 日记 / P4 反思+承诺（✅ 核心完成）

- 日记：`lib/diary.js`，每天 22 点后由调度器逐群生成（0 token，素材只来自 events）；3–6 句第一人称；同一天幂等；整篇不注入，只经 `diaryHint()` 给一句。
- 承诺：`lib/promises.js`，只从「她发出去的话」抓（`origin=bot`），同句幂等；逾期 2 天标记；`#承诺` 列、`#兑现 <编号>` 关；未完成承诺进接续包。
- 反思：`lib/reflection.js`，只吃事件与承诺、不读日记（防自我强化）；3–5 条/天 + 指标；`weekSummary` 给周报/面板。
- 测试：`test/p3-diary-test.mjs`（11）、`test/p4-promise-test.mjs`（15）。

---

## 7.7 P5 记忆双卡（✅ 核心完成）

- 全量卡：`<memory>/<peer>.full.jsonl`，只追加、永不注入（`fullCard()` 按需/面板读）。
- 衰减卡：进提示词，按 `memory.injectChars`（默认 300 字）截断；超容量按 P 淘汰，但 `pinned` / `stable_profile` 永不裁。
- 水位：80/90/100%，每 peer 每档每天一次审计（`memory.watermark`），不删 durable。
- 测试：`test/p5-memory-test.mjs`（10）。

---

## 8. 停止条件（遇到就停，不硬推）

- 宿主接口行为与方案假设不一致（压缩事件、systemPrompt、agent 创建）
- 需要改部署目录才能验证
- 数据迁移不可逆且没有备份
- 测试无法稳定复现（先修测试/环境，再继续）

---

## 9. 上线前检查（最后一步，需明确批准）

- [ ] 全量测试绿 + 接线扫描绿
- [ ] 部署前备份 `~/.dsh/plugins/dsh-qqbot-refine` 与数据目录
- [ ] `sync-to-deploy.ps1` → 重启 DSH → 验收清单
- [ ] 出问题回滚：恢复备份 + 开关关闭
- [ ] 版本号/标签/文档同步


## 7.8 P8–P14（✅ 仓库内完成，未部署）

- P8 反八股：`lib/anti8gu.js` 检测→一次重写→降级；周审计只记次数。
- P9 生图：搜索默认关（只服务确认文案）；character lock|free|auto；confirmMode always|smart|off；耗时审计。
- P10 能力运行时：`lib/caprun.js` 统一契约（policyKey/成本/超时/失败码/审计）；生图/语音/搜索/小黑盒注册为能力。
- P11 支付流：`lib/payflow.js` + `#支付/#确认支付/#支付记录`；模型永远不能自己付钱；限额/确认码/重放全部走 gateway。
- P12 生活参数：`lib/lifeparams.js` 30 项、范围/历史/回滚；模型一步 ≤0.5；硬边界不在表内。
- P13 登录桥：`lib/bridge.js` 专用资料夹开登录页（人自己输密码），CDP 状态探测；B站动态去重台账。
- P14 收尾：小黑盒只读能力（CLI 缺失/超时都有码）；`identity.takeover=false` 回滚；面板显示名改为「大肥鱼 · 身份系统」。

**部署时再做**：包名改 `dsh-identity` + 旧名兼容壳 + 数据目录复制迁移（旧留 30 天）——这几步必须跟部署/重启一起做，单独改会把线上弄断。
