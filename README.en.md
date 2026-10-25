# dsh-qqbot-refine

An enhancement plugin for QQ bots running on **DeepSeek Harness**.
Everything that can be decided without the model (rate limits, privacy, memory, profiles,
stickers, moderation, Bilibili feeds, image reading) happens **before** the model call, so
commands and pushes cost **0 tokens**.

## Features

| Area | What it does |
|---|---|
| Rate gateway | per-group / per-user / global limits, natural-chat mode with gears 1-5, cooldowns, quiet hours, burst & backoff |
| Privacy | outbound redaction (keys, paths, model names), prompt-injection guard, per-scope allowlist, audit log |
| Persona | QQ-only persona presets (group / quiet / DM / explainer), injected as a system-prompt section |
| Memory | half-life memory (base 30 d, emotion 7 d), recall by keyword, `[[remember: ...]]` markers |
| Profiles | per-member stats and traits, refreshed daily, injected as a "who is who" card |
| Stickers | 270+ remote stickers by mood, collection from groups, `[[sticker:auto]]`, dedupe and daily caps |
| Moderation | layering (owner / admin / member), mute, recall, QQ group-owner detection from events (0 API calls) |
| Images | QQ image attachments are downloaded and described (vision tool), with per-group daily caps |
| Mood | local 7-dimension mood engine (appraisal + inertia + half-life), optional LLM appraisal with a token budget |
| Learning | learns owner/admin rules from chat, learns "does this group react to me", adapts activity accordingly |
| Knowledge base | local Markdown knowledge per group + shared, retrieved by keyword overlap, injected only on hit |
| Bilibili | dynamic polling, link parsing, optional video clipping via yt-dlp |

## Requirements

- DeepSeek Harness with the QQ bot plugin (`@tencent-connect/dsh-qqbot`)
- Node.js >= 20
- Optional: `sharp` (help cards / sticker size checks), `yt-dlp` (video clipping), a local TTS service for voice

## Install

```bash
# inside your DSH profile directory
npm i dsh-qqbot-refine
```

or copy this folder into `~/.dsh/profiles/<profile>/node_modules/dsh-qqbot-refine`.

The plugin registers itself through `cordis.patch.yml` (`dsh.bundle.patch`) and adds a web panel at
`/qqbot-refine` served by the host web server.

## Panel

Tabs: scope / rate / privacy / persona / **mood** / memory / profile / stickers / order / bilibili / voice / proactive / usage.
Everything is editable in the panel; config is stored at
`<DSH_HOME>/storages/dsh-qqbot-refine/settings.json` with automatic backups.

## Group commands (0 token)

`#帮助` · `#群状态` · `#闭嘴` / `#说话` · `#表情` · `#B站` · `#用量` · `#学到的` · `#知识 [关键词]` · `#赛程` / `#交手 A B` · `#绑定`

## Layout

```
index.js          plugin entry (hooks + panel routes + system-prompt sections)
client.js         client-side bundle hook
lib/
  gate.js         inbound/outbound gateway (the core)
  config.js       schema, defaults, panel field map
  privacy.js      redaction rules
  guard.js        prompt-injection / secret guard
  memory.js       half-life memory
  profile.js      member profiles
  persona.js      persona injection + session mapping
  presets.js      built-in persona presets
  sticker.js      sticker library
  roles.js        owner/admin resolution
  state.js        mute/cooldown/counters
  humanize.js     de-AI formatting, bubble splitting, typing delay
  mood.js         mood sources and tone mapping
  moodlocal.js    local 7-dimension mood engine
  moodllm.js      optional LLM mood appraisal (budgeted)
  learn.js        rule learning + adaptation
  knowledge.js    local knowledge base
  esports.js      local match records
  usage.js        real token usage and cost
  toolgate.js     tool-call gate for QQ sessions
  bili.js voice.js proactive.js card.js diag.js api.js store.js fit.js directed.js gear.js permgear.js mgmt.js
panel.html        web panel (single file)
```

## Notes

- Nothing is sent to the model that a gate could have answered: commands, pushes, mood bookkeeping
  and knowledge retrieval are local.
- The tool gate denies out-of-workspace paths and sensitive arguments for non-owner QQ sessions.
- This plugin never grants itself extra permissions; it only wraps already-registered tools.

## License

MIT - see [LICENSE](./LICENSE). Copyright (c) 2026 鲸鱼娘和染喵.
