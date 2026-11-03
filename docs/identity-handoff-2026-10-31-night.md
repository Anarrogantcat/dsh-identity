# dsh-identity 交接：2026-10-31 夜间（「像人」那一轮）

新会话直接照这份走。前一份 `dsh-identity-handoff.md` 仍然有效，这份只记这一轮新增的。

## 一句话

目标从「记录型 → 成长型」改成了「像人，而不是装人」：连续自我、情绪起伏、因经历改变、有自己惦记的事、有精力上限、少设卡。

## 这轮挖出来的真问题（都不是猜的，有数据）

1. **自我模型从来没进过提示词**——`buildSelfModel()` 只在面板状态接口被调用，身份段注入走的是 `identitySectionText`，里面根本没有它。精力和变化写了文件、上了面板，就是没进她脑子。已修：`contextSectionText` 第一段注入自我模型。
2. **判断蒸馏交白卷**（已修好，别再动）——审计里 `outputTokens` 用满 900、`finish` 是 error、正文空：模型把额度全烧在思考上。修了三轮：260→2000 token；对话 1800→1200 字；最后把任务本身简化（不要 JSON 数组，一行一条判断）+ 解析器按行兜底。**重启后已验证成功**：`finish: stop`、349 token、一次产出 3 条判断卡。
3. **好奇永远为空**——`curiosities` 判「问句后面有没有任何 bot 发言」，群里 bot 一天说 300+ 句，51 个无人接住的问句全被算成「接过了」。已改成只看紧跟着的 3 条。
4. **feedback 分类存不进去**——`CATEGORIES` 白名单里没有 `feedback`，所有「被提醒」都被归一成普通事件。已加。
5. **承诺池脏**——只要含「记得」就记成承诺，「谁还记得刚才在聊什么」也被挂上。已收紧：第一人称未来动作 + 排除问句/提醒别人。
6. **宿主 goal_round 注入被当用户消息记进记忆**——12 条超长污染。已加剥离规则 + `scripts/clean-goalround.mjs` 清理（注意：重启前每轮还会再进一条，手动清）。
7. **乱插话**——casualJoin 的提示词是「有点意思就接」，别人自述「马上没饭吃了」也去接。已改成只接问句/求助。
8. **余额误用**——余额提示词对谁说话都注入，别人说「余额用完」它去查自己钱包。已改成只对主人注入。
9. **check-version 脚本自己会骗人**——不递归、吞 EISDIR，selfmodel 没同步也说「一致」。已修。

## 数据侧曾经的两个假象

- 自我快照三条隔 12 小时一字不差，只有心情标签在换 → 已改成「写不出跟上次比改了什么就不许存」。
- 69 条自我认知全是 tentative、durable 为 0 → 拆了「跨 2 天」门槛（证据够 3 次就升），并让相似措辞合并到同一条。现在 durable 有 1 条了。

## 已生效的改动（10-31 深夜重启后验证过）

- `lib/judge.js`：900 token + 默认推理档
- `lib/reflection.js` / `lib/diary.js` / `lib/inner.js` / `lib/proactive.js` / `lib/profile.js`：token 预算上调（300→800 等）
- `lib/autonomy.js`：好奇只看紧邻 3 条
- `lib/webgrowth.js`：web 会话补复盘 + goal_round 剥离
- `lib/selfmodel.js`：时间感 + 「在变的地方」过滤噪音
- `lib/promises.js`：承诺句式收紧
- `lib/channel-qq/gate.js`：casualJoin 只接问句 + 余额只给主人
- `index.js`：自我模型进上下文段

## 怎么验证

`docs/identity-acceptance.md` 有清单。快速版：

```bash
node scripts/check-version.mjs    # 新版加载了吗
node scripts/growth-status.mjs    # 六条链的数据
node scripts/growth-status.mjs --append   # 记进时间线
```

## 运维备忘

- 源码换行是 LF，部署目录是 CRLF，直接比 hash 会全红。要比内容先去掉 `\r`。
- `scripts/check-version.mjs` 已递归比对，104 个 js。
- 插件 JS 改动必须重启；`panel.html` 和配置每次现读盘。
- 部署目录：`~/.dsh/plugins/dsh-identity`，desktop profile 用 junction 指过去。

## 还没做的

- 群聊说话占比 28.4%，偏高但不离谱；要不要再压，看主人感受。
- 「连续 4 条拆句」是否过多，没调。
- 旧的脏承诺、旧的三条复读快照还在文件里（新规则只管以后）。

## 2026-11-02 复查（两天后的真实数据）

数据是好的，但有两处质量渣，新会话先处理这两个：

- **稳定认知 8 条，其中 2 条是空壳**：「我把『把「？」这事弄明白』弄明白了」「我开始留意：把「？」这事弄明白」。某次 autonomy 目标标题为空，留下 `把「？」这事弄明白` 这句模板，被当成认知升成了 durable。**待办**：在 autonomy 的 `makeGoal` 或 `traitObserve` 前拦掉空标题。
- **自主目标 11 个，推进中 0 个**。惦记有了，行动为零。**待办**：查 `runGoal` 的调度为什么没跑起来（调度器/预算/审批哪一环卡住）。
- 判断卡 4 条，内容全是技术向的（「重启后才能加载新token参数」「输出token不足时优先保正文」「精力低时回复要更简短」）——说明它记的是「怎么修机器」，还没记「主人是什么样的人」。
- 自我快照开始写「跟上次比：情绪从 X 变成 Y」，不再复读。
- 精力 36–42%，今天硬撑 4 次，tone=terse。这部分是真的在工作。
