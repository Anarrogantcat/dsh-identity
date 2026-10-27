# 方案 A：给 NapCat 开一个 WebSocket 服务端（只列方案，不执行）

> 目的：让我们能调用 OneBot API（`get_group_list` / `get_friend_list` / `get_group_member_list`），
> 拿到群列表、好友列表、群名片 —— 官方通道拿不到这些（或受 30 QPM 限制）。

## 1. 现状（实测）

| 项 | 值 |
|---|---|
| NapCat 配置 | `D:\AI\QQBOT\NapCat\config\onebot11_100000001.json` |
| `websocketClients` | **1 条**：`ws://localhost:2536/OneBotv11`（NapCat 主动连 Yunzai） |
| `websocketServers` | **0**（NapCat 不监听） |
| `httpServers` / `httpSseServers` | 0 / 0 |
| NapCat WebUI | `http://127.0.0.1:6099` **可用**（HTTP 200，PID 8116） |
| 端口占用 | 2536(Yunzai) / 6099(WebUI) / 8080(其它)；**3001 空闲** |

## 2. 目标形态

```
NapCat
  ├─ websocketClients  → ws://localhost:2536/OneBotv11   （Yunzai，保持不动）
  └─ websocketServers  → ws://127.0.0.1:3001            （新增，给 DSH / 调试用）
```

两者独立：Yunzai 那条不受影响，新开的是**入库方向相反**的服务器。

## 3. 两条实施路径（推荐 A1）

### A1 用 WebUI 添加（推荐，零手误）
1. 打开 `http://127.0.0.1:6099`
2. 「网络配置」→「Websocket服务器」→ 新增
3. 填：
   | 字段 | 建议值 |
   |---|---|
   | 名称 | `DSH-API` |
   | 启用 | 是 |
   | host | `127.0.0.1`（**不要 0.0.0.0**） |
   | port | `3001` |
   | token | **随机 32 位**（必填，否则本机任何程序都能调） |
   | messagePostFormat | `array` |
   | reportSelfMessage | 否 |
   | debug | 否 |
   | heartInterval | 30000 |
4. 保存 → 重启 NapCat 生效

### A2 手改 JSON（需要时用）
1. 备份：`Copy-Item onebot11_100000001.json onebot11_100000001.json.bak-2026-10-26`
2. 在 `network.websocketServers` 追加一条（字段以 WebUI 生成结果为准，含 `name/enable/host/port/token/messagePostFormat/reportSelfMessage/debug/heartInterval`）
3. 重启 NapCat
4. **回读文件**确认 NapCat 没有把它规范化掉（如果改了，以它写回的为准）

## 4. 生效与验证

### 4.1 重启 NapCat（QQ 会短暂重连，几十秒）
- 影响：Yunzai 的 B 站推送会中断这几十秒；恢复后自动重连
- 建议时机：群里没人说话的时候

### 4.2 验证端口
```powershell
Get-NetTCPConnection -LocalPort 3001 -State Listen
```

### 4.3 验证 API（Node 24 自带 WebSocket 客户端，无需装包）
```js
const ws = new WebSocket('ws://127.0.0.1:3001/', { headers: { Authorization: 'Bearer <token>' } })
ws.onopen = () => {
  ws.send(JSON.stringify({ action: 'get_group_list', params: {}, echo: 'g' }))
  ws.send(JSON.stringify({ action: 'get_friend_list', params: {}, echo: 'f' }))
}
ws.onmessage = (e) => { const d = JSON.parse(e.data); if (d.echo) { console.log(d.echo, JSON.stringify(d.data).slice(0, 300)) } }
```

### 4.4 期望拿到
| 接口 | 产出 | 用途 |
|---|---|---|
| `get_group_list` | 群号 / 群名 / 人数 / 最大人数 | 自动填白名单 |
| `get_friend_list` | QQ / 昵称 / 备注 | 私聊白名单参考 |
| `get_group_member_list` | 成员 QQ / **群名片** / 角色 | 画像、叫对名字、群管识别 |

## 5. 与后续 S2 的关系（避免两条入口重复）

| 选择 | 说明 |
|---|---|
| **只用 3001（本方案）** | DSH 作为 WS **客户端**连 NapCat，最省事；S2 直接复用 |
| 用 8643（原方案的 ws-reverse） | NapCat 主动连 DSH，需要 DSH 先起服务端 |
| 两者都要 | 不建议（收两份事件，容易双处理） |

> 建议：**走 3001 这条**，原方案里的"NapCat 加 ws-reverse 客户端"取消。

## 6. 安全

- 只绑 `127.0.0.1`，不碰公网
- token 必填，随机 32 位进 `onebot11_*.json`（不入库、不进开源仓库）
- 不要在这条连接上开 `reportSelfMessage`（避免回声）

## 7. 回滚

- WebUI：删除 `DSH-API` 条目 → 重启
- 或还原备份 JSON → 重启
- 回滚不影响 Yunzai 那条连接

## 8. 风险

| 风险 | 程度 | 说明 |
|---|---|---|
| 重启期间推送中断 | 低 | 几十秒，自动重连 |
| 端口冲突 | 低 | 3001 目前空闲 |
| token 泄露 | 低 | 仅本机绑定；仍建议随机 token |
| NapCat 规范化字段 | 低 | 手改后回读确认 |

## 9. 验收

- [ ] 3001 处于 Listen
- [ ] `get_group_list` 返回群列表（至少 1 个群）
- [ ] `get_group_member_list` 返回**群名片**（不再只有 QQ 昵称）
- [ ] Yunzai 的 B 站推送在重启后恢复正常
- [ ] token 验证失败时请求被拒（试一次错 token）

## 10. 工作量与下一步

约 **15 分钟**（改配置 + 重启 + 验证）。

验证通过后，就可以：
1. 把群号自动填进白名单
2. 用群名片重建画像
3. 进入 S2（DSH 连 3001，接住入站/出站）

> 注意：本方案只开"查询入口"，**不会让 DSH 开始回话**——回话要等 S2 挂上 dsh-onebot 通道。
