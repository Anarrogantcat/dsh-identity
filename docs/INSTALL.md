# 安装 dsh-qqbot-refine

> 面向 DSH（DeepSeek Harness）桌面版 / Web 版的第三方插件。需要 Node **≥ 20**，Node 由 DSH 自带，通常不用另装。

## 0. 先决条件

| 项 | 说明 |
|---|---|
| DSH | 已能正常启动（桌面版或 `dsh web`） |
| 通道 | 二选一：**NapCat / OneBot 11**（推荐，WS 默认 `ws://127.0.0.1:3001`）或**官方 QQ 机器人**（appId/appSecret） |
| 可选依赖 | `sharp`（#帮助 卡片）、`silk-wasm`（发语音）——宿主 profile 里已有就自动用，没有则对应功能降级 |

## 1. 拿到代码

```powershell
# GitHub（当前是私有仓库，需要把仓库加为你的协作仓库）
git clone https://github.com/Anarrogantcat/dsh-qqbot-refine.git "$env:USERPROFILE\.dsh\plugins\dsh-qqbot-refine"
```

没有 GitHub 权限就用压缩包解压到同一路径。目录名建议就叫 `dsh-qqbot-refine`。

## 2. 挂到 DSH 的 profile 上

编辑 `%USERPROFILE%\.dsh\profiles\<你的profile>\package.json`（一般是 `desktop`）：

```jsonc
{
  "dependencies": {
    // 追加这一行
    "dsh-qqbot-refine": "file:../../plugins/dsh-qqbot-refine"
  },
  "dsh": {
    "profile": {
      "bundles": [
        // ……原有的别动，数组末尾追加
        "dsh-qqbot-refine"
      ]
    }
  }
}
```

然后二选一建立链接：

```powershell
# A) 让包管理器装（profile 目录下执行）
pnpm install

# B) 或者手动建 junction（Windows 管理员/PowerShell 普通权限均可）
cmd /c mklink /J "%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-qqbot-refine" "%USERPROFILE%\.dsh\plugins\dsh-qqbot-refine"
```

## 3. 重启 DSH

插件是宿主进程内的 cordis 插件，**必须重启 DSH** 才会加载。

重启后：
- 侧边栏/设置里出现「大肥鱼 · QQ 增强」入口
- 或直接开 `http://127.0.0.1:<DSH端口>/api/qqbot-refine/panel`

## 4. 第一次配置

1. **通道**：面板「通道」页 → 选 `NapCat / OneBot`（填 WS 地址和 token）或 `官方 QQ`（填 appId/appSecret）
2. **白名单**：把群号/QQ 加进 `scope.groups`、`roles.owners`（你本人）
3. **重启 DSH**（切通道后需要）
4. 群里发 `#绑定本群`（群主/管理员可用），或面板生成绑定码后在群里发 `#绑定 <码>`
5. 发 `#帮助` 看她回不回卡片 → 通了

## 5. 语音（可选）

语音是外挂服务（CosyVoice3/RVC/SVS），不在本插件里。插件侧只需在面板「语音」页填：

| 字段 | 示例 |
|---|---|
| `voice.enabled` | 开 |
| `voice.baseUrl` | `http://127.0.0.1:9881` |
| `voice.apiKey` | 服务端的 key |
| `voice.autoStart` | 开（服务没跑时自动拉起） |

服务端部署见本仓库 `docs/voice-service.md`（可选，不装也能正常聊天）。

## 6. 常见问题

| 现象 | 处理 |
|---|---|
| 面板 404 | 插件没被加载：检查 profile 的 `bundles` 是否加了名字、`node_modules` 是否有链接 |
| 通道 connected=false | NapCat 没开 / token 不对 / WS 端口不是 3001 |
| 群里不回话 | 看「通道」页计数：`blocked` 涨 = 被频率闸门挡（调 `frequency.*`）；`errors` 涨 = 看审计日志 |
| 提示没有 `sharp` | `#帮助` 会退回文字；想用卡片就在 profile 里 `pnpm add sharp` |
| 发语音失败 | 没装 `silk-wasm` 或语音服务没起；面板「语音状态」卡会显示原因 |

## 7. 数据位置

```
%USERPROFILE%\.dsh\storages\dsh-qqbot-refine\
  settings.json        配置
  logs/audit.jsonl     审计（每次拦截/发送/命令都有）
  profiles/            画像
  memory/  knowledge/  记忆与知识库
  downloads/           大文件（模型/ffmpeg）
```

换盘：在项目里跑 `scripts/move-data.ps1 -Target D:\qqbot-data`，或只改「大文件下载目录」字段。
