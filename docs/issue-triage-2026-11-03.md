# 外部反馈汇总（2026-11-03）

三个都看过了：PR #3、issue #1、issue #4。结论和回复草稿都在这，代码改动在另一轮做。

---

## PR #3 · feat: configurable owner companion and QQ workspace flow

- 作者 shuaig22，3 commit，117 文件，+1742/−199，open，mergeable clean
- 内容：主人私聊陪聊节奏（`lib/companion.js`，auto/quiet/balanced/chatty）、QQ 会话同步进 workspace、私聊镜像成 DSH 会话、人设从 `identity.baseText`/文件读、90 个测试改用 `test/_test-home.mjs`
- 和本地冲突：本地 HEAD 就是它的 base（`8516cb5`），但我们有 20+ 文件**未提交**（client.js / index.js / gate.js / config.js / proactive.js / panel.html / onebot-channel.js 都在名单里）。GitHub 说 clean 是相对 main，不是相对工作区
- **决策：cherry-pick，不整包吞**
  1. 拿 `lib/companion.js` + 配置项 + gate 里的 companionTimer
  2. `composeCompanionMessage` 的 `fallbackText` 那支改成「说不出来就返回 null」，跟我们的主动搭话规矩对齐
  3. `persona-file` / QQ 同步单独评估
  4. 90 个测试的 `_test-home.mjs` 迁移**不跟着进**，跟功能无关，会把 review 淹没

---

## issue #1 · 外部注入轮次被禁工具 + ui-config 丢字段

- 作者 THEJJJ-gif，DSH 0.2.1-rc.3，本地目录装
- 报告质量高：三种注入方式都复现，`tools.guard` 放行、显式设 `danger-full-access` 都无效，而且**注入一次后同会话后续真实轮次也没工具，重启才恢复**
- 我的评估：这条比「权限不足」严重——像是注入轮把会话的权限状态写脏了，属于宿主侧问题，不是插件能修的
- 维护者已回：「没有官方 API、建议开独立会话」。方向对，但两处要修：
  1. **别说「确认」**。我们本地没有 rc.3，复现不了；应说「与设计意图一致，待上游确认」
  2. **和 PR #3 自相矛盾**：PR #3 的「私聊镜像成 DSH 会话」走的就是这条注入路。要么 PR 改成新会话 + 带上下文，要么这条建议要放宽
- 建议动作：拿最小复现往上游客端提 issue（会话被永久降权不是有意设计）；插件侧保持「每 peer 一个会话」，本来就没踩这条

**回复草稿（补发一条）**

> 补充两点，避免误导：
> 1. 我这边没有 rc.3 环境，没法复现，所以前面说的「确认」应理解为「与当前设计的边界一致」，不是已定位的定论。会话被注入一次后持续降权、必须重启才恢复，这个行为更像 bug——建议带着你的最小复现往上游客端报一份，我可以帮你把复现步骤整理成能直接跑的脚本。
> 2. ui-config 那条你说得对：未注册字段保存时会被清掉，要持久化请走 profile patch 或独立配置节。我们自己的配置存在 `storages/dsh-identity`，不经过 ui-config，所以确实不受这条影响。

---

## issue #4 · Docker 镜像里装完就崩

- 作者 user-et，镜像 `moelin/deepseek-harness:latest`，`dsh plugin --profile web add github:...`，容器无限重启（exit 1）
- 我做的静态检查：
  - 插件**零运行时依赖**（`dependencies` 为 null，只有 devDependency `jsdom`）→「缺编译环境 / Cannot find module」概率低
  - 裸 node `import('./index.js')` 通过，7 个导出 → 不是语法或顶层抛错
  - Windows 专属代码（msedge、powershell）都是调用时才执行，不在导入期
- 判断：更可能是容器里的存储目录权限、宿主初始化时报错、或与镜像里其它插件冲突。需要日志才能定
- 为了少来回一趟，新增 `scripts/selfcheck.mjs`：容器里裸跑一条命令就能把「环境问题」和「插件 bug」分开

**回复草稿（补发一条）**

> 给你一条能直接跑的排查命令，比猜快：
>
> ```bash
> docker exec -it <容器名> sh -lc "cd /path/to/plugins/dsh-identity && node scripts/selfcheck.mjs"
> ```
>
> 它会输出 Node 版本、插件能否 import、存储目录能不能写、配置能否解析。如果里面出现 FAIL，基本是环境问题（Node 版本 / 只读挂载 / 权限），把那段原样贴出来就行；如果全过，那崩溃点更可能在宿主侧或与镜像里其它插件的交互，再要 `docker logs` 最后 100 行才有意义。
>
> 另外想确认三件事：镜像里的 Node 版本；`~/.dsh` 是不是只读挂载；这台容器是不是同时装了别的插件（尤其是会抢端口或改配置的）。

---

## 待办

- [ ] PR #3：fetch 分支 → 跑 companion-test → 按上面 1~4 拆
- [ ] issue #1：整理最小复现脚本，往上游客端提
- [ ] issue #4：等对方跑 selfcheck，拿结果再定
- [ ] 我们自己：QQ ↔ DSH 的会话同步，一律「独立会话 + 带上下文」，不用注入
