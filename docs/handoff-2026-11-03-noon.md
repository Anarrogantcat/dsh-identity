# 交接（2026-11-03 中午，换会话用）

新会话第一件事：把**目标窗口**挂上（上一轮就是忘了挂目标，界面上只能看到一条「已暂停的目标」）。

## 新会话开场就做（按顺序）

1. **挂目标**（用 `create_goal`，目标文案用下面这段）：

   > 按主人目标完善 dsh-identity「像正常人」：记事、判断、会累、共情、人格、七情六欲。已完成：共情/精力/暂停（1.9.217）、记忆分层注入（1.9.219）、空壳认知清理、外部反馈三分类、同类插件学习记录。下一步按 docs/roadmap-2026-11-03.md：1) 收口者——自主目标有真产出才算完成；2) 判断卡记人验证；3) 记忆巩固层与置信度遗忘；4) toolgate 白名单自查。每步带测试并部署。

2. **确认预设：选「创造模式」**（preset id `cordis`）。写插件、改 bundle 本来就应该在创造模式里做；而且查过出货的 `presets/cordis.patch.yml`，它自带 `command-goal` + `tool-goal`，`get_goal`/`update_goal` 都在。之前那个会话是 Team Lead 预设才缺这两个工具，不是模式的锅。

3. **精力不压活**：主人明确说「先不要让精力影响到写插件」。已加开关 `frequency.workMode`（默认 false）。开着时自我模型里那句「很累，能一句说完就一句，别主动找事」会变成「精力只当状态记着，不影响干活的力度」。
   - 打开方式：配置里设 `frequency.workMode: true`（面板「频率」页；面板字段还没加，暂时改 config.json 也行）
   - 注意：这只影响提示词里的语气，不改精力计算；「会累」本身仍是主要目标之一，别把它关死

## 现在的状态

- 版本 **1.9.219** 已部署，171 个测试全绿，`node scripts/check-version.mjs` 报源码与部署一致
- 源码 `D:\AI\DeepSeek Harness Workspace\dsh-qqbot-refine`（分支 `feat/p0.5-wiring`，**大量改动还没 git commit**）
- 部署目录 `<DSH_HOME>\plugins\dsh-identity`
- 数据 `<DSH_HOME>\storages\dsh-identity`（traits 已清空壳，备份在 `traits.json.bak-2026-11-03T04-00-24-604Z`）

## 计划在哪

- `docs/roadmap-2026-11-03.md`：三阶段（主要目标 → 次级目标 → UI），阶段 0 收尾表、阶段 1 六条现状/缺口/验收、「学习成果落地顺序」六项
- `docs/plugin-study-2026-11-03.md`：同类插件学习记录（只读了三份 README，没读源码，没搬代码）
- `docs/issue-triage-2026-11-03.md`：PR #3 拆包方案、issue #1/#4 评估与回复草稿
- `dsh-identity-handoff.md`（工作区根目录）：历史交接，按时间追加

## 下一步（按 roadmap 顺序）

1. **收口者**：`lib/autonomy.js` 的目标加收口步——必须真产出一条判断卡 / 一次真提问 / 一条事实记忆才算 done，否则退回 pending。带测试
2. 判断卡记人的效果验证（提示词已改，等一次真实蒸馏）
3. 记忆「巩固」层：7 天以上原话压成摘要；memory 加 `confidence`
4. `toolgate` 白名单自查（companion 踩过的坑：只看全局层会误杀预设层工具）

## 坑（别重复踩）

- 面板 `panel.html` 每次请求现读盘；`client.js` 刷新页面生效；**宿主侧 js 必须重启**
- 部署后跑 `node scripts/check-version.mjs`，104 个 js 要一致
- 清理类脚本默认只读，`--apply` 才动，先备份
- test 里 `ui-render-smoke` / `ui-interaction-smoke` 取的是**最长的那段 script**，别再改回 `[0]`
- 公开仓库 `Anarrogantcat/dsh-identity` 有 PR #3 和 issue #1/#4 在等，别直接合
