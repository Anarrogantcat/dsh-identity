# 文档索引

| 文件 | 是什么 | 什么时候看 |
|---|---|---|
| [PLAN-FINAL](qqbot-refine-PLAN-FINAL.md) | **权威蓝图**（19 节：架构 / S1–S7 / 验收 / 数据迁移） | 想知道「当初为什么这么做」 |
| [NEXT-SESSION](qqbot-refine-NEXT-SESSION.md) | **交接入口**：一句话状态、已完成阶段、下一步、怎么验证没退化 | 每次接手先看这个 |
| [COGNITION](qqbot-refine-COGNITION.md) | 认知层设计（四张卡 / 关系图 / 巩固） | 改 S7 相关逻辑前 |
| [COST-PLAN](qqbot-refine-COST-PLAN.md) | 成本与花费闸设计 | 动 `usage.*` / `cost.js` 前 |
| [FULL-SPEC](qqbot-refine-FULL-SPEC.md) | 早期完整规格（被 PLAN-FINAL 合并，留档） | 查历史取舍 |
| [GAP-REPORT](qqbot-refine-GAP-REPORT.md) | 能力缺口盘点（官方 vs NapCat） | 判断某项能力归哪条通道 |
| [MIGRATION-PLAN](qqbot-refine-MIGRATION-PLAN.md) | 从腾讯通道迁到 NapCat 的步骤与风险 | 换通道 / 换账号时 |
| [HANDOFF](qqbot-refine-HANDOFF.md) | 早期交接长文（含当时实测数据） | 考古用 |
| [napcat-ws-server-plan](napcat-ws-server-plan.md) | 给 NapCat 开 `websocketServers` 的方案 | 第一次联调 |

## 目录结构

```
dsh-qqbot-refine/
├─ index.js            插件入口（cordis apply）
├─ panel.html          控制面板（单文件原生 JS）
├─ client.js           浏览器半边：右下角悬浮按钮
├─ lib/
│  ├─ onebot-channel.js   自建 OneBot 通道（事件→闸门→agent→发送）
│  ├─ onebot-client.js    OneBot 11 WS 客户端
│  ├─ onebot-inbound.js   notice 事件分类 / 合并转发拍平
│  ├─ gate.js             闸门（频率/隐私/命令/花费/安全）
│  ├─ admin.js            群管与互动动作（OneBot 专用）
│  ├─ transport.js        通道抽象（tencent | onebot 单活）
│  ├─ capabilities.js     15 项能力位
│  ├─ roster.js           名册（群/好友/成员）
│  ├─ safety.js           安全档位 / 熔断 / 被踢记录
│  ├─ relations.js        人物卡 + 关系图
│  ├─ cards.js            自我卡 + 待办卡
│  ├─ digest.js           离线巩固（每小时摘要）
│  ├─ hooks.js            通道事件 → 认知/安全 的接缝
│  └─ …                   memory / profile / mood / sticker / esports / knowledge / usage / cost …
├─ test/               59 个测试 + run-all.mjs 运行器
└─ docs/               本目录
```
