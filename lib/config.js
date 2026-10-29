/** 配置：默认值 + 字段表（面板与服务端校验共用）+ 读写 */
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync, readdirSync, unlinkSync } from 'node:fs'
import { join, isAbsolute } from 'node:path'

export const DSH_HOME = process.env.DSH_HOME || join(process.env.USERPROFILE || process.env.HOME || '.', '.dsh')
/** 默认数据目录（C 盘那个） */
export const DEFAULT_STORE_DIR = join(DSH_HOME, 'storages', 'dsh-qqbot-refine')

/**
 * 数据目录解析顺序（整库可以挪到别的盘，C 盘放不下时用）：
 *   1) 环境变量 QQBOT_REFINE_HOME（最直接，改完重启 DSH）
 *   2) 默认目录下的指针文件 .data-path（一行绝对路径）—— 用 scripts/move-data.ps1 生成
 *   3) 默认目录
 */
function resolveStoreDir() {
  const env = String(process.env.QQBOT_REFINE_HOME ?? '').trim()
  if (env && isAbsolute(env)) return env
  try {
    const ptr = readFileSync(join(DEFAULT_STORE_DIR, '.data-path'), 'utf8').trim()
    if (ptr && isAbsolute(ptr)) return ptr
  } catch { /* 没有指针文件 */ }
  // 改名迁移后优先用新目录（旧目录留 30 天，脚本迁移）
  const migrated = join(DSH_HOME, 'storages', 'dsh-identity')
  try { if (existsSync(migrated)) return migrated } catch { /* ignore */ }
  return DEFAULT_STORE_DIR
}

export const STORE_DIR = resolveStoreDir()
export const CFG_PATH = join(STORE_DIR, 'settings.json')

/** 当前指针文件内容（空串 = 没设置） */
export function dataPointer() {
  try { return readFileSync(join(DEFAULT_STORE_DIR, '.data-path'), 'utf8').trim() } catch { return '' }
}

/** 写指针文件：把数据目录指向 target（目录不存在会自动建） */
export function setDataPointer(target) {
  const dir = String(target ?? '').trim()
  if (!dir || !isAbsolute(dir)) throw new Error('需要绝对路径')
  mkdirSync(dir, { recursive: true })
  mkdirSync(DEFAULT_STORE_DIR, { recursive: true })
  writeFileSync(join(DEFAULT_STORE_DIR, '.data-path'), dir, 'utf8')
  return dir
}

export const DEFAULTS = {
  version: 2,
  scope: { groups: [], dmUsers: [] },
  roles: { owners: [], admins: [], adminAutoFromQqOwner: true, adminMaxMutePerDay: 10, adminMaxRecallPerDay: 20 },
  frequency: { ownerPriority: 'high',
    naturalMode: true, mentionOnlyGroups: false, 
        quietEnabled: true, quietStart: '23:30', quietEnd: '08:00',
    maxRepliesPerTurn: 3,
    chatMode: 'mention', naturalMode: false, aliases: ['大肥鱼', '肥鱼', '鱼鱼', '鲸鱼娘', '鲸鱼'], stickyMin: 5, selfGapSec: 8, chainWindowSec: 120,
    triggerAlias: true, triggerQuestion: true, triggerRandom: true,
    fitJudge: true, fitThreshold: 0.35, directThreshold: 0.5, fitTopics: [], fitNegative: [],
        typingEnabled: true, typingMsPerChar: 25, typingMaxMs: 2500, splitMinChars: 40,
    burstWindowSec: 10, burstCount: 5, backoffSec: 60,
    mentionPriority: true, mergeWindowSec: 0, ignoreSelf: true,
  },
  privacy: {
    enabled: true,
    redactOutbound: true,
    defaultRules: true,        // 内置脱敏规则（手机号/身份证/卡号/邮箱/内网IP/密钥/路径/模型名）
    blockBuiltin: false,       // 内置拦截词（索要隐私的问法）默认关，避免误杀
    blockKeywords: [],         // 自定义丢弃词
    redactKeywords: [],        // 自定义脱敏词
    memoryRedact: true,        // 记忆入库前脱敏
    guardPrompts: true,        // 防套话/提示注入（非 Owner）
    blockDangerIntent: true,   // 拦「读文件/执行命令」这类危险意图
    hardSecrets: true,         // 真实凭据原样回显兜底（开放档也建议留着）
    guardMode: 'reply',        // reply=回固定话术；drop=静默丢弃
    guardReply: '这个不方便说呀。',
    allowedHosts: [],          // 允许出现的外链主机（空=不限制）
    blockLinks: false,         // 丢弃含链接的消息
    newUserObserve: false,     // 新人观察：发言不足前不建画像
    redactNames: false,        // 额外脱敏：@昵称
    inboundMedia: 'allowlistOnly', // allow / allowlistOnly / deny
    fileRoots: [],
    fileMaxMB: 20,
    auditDays: 30,
  },
  persona: { scale: 50 },
  // 身份内核（L1）：内核/场景/风格/自我 → 单一注入段；预算硬上限
  identity: { enabled: true, takeover: true, maxChars: 1400, traitsMax: 5, baseText: '' },
  memory: { auto: true, autoPerDay: 15,
    enabled: true, baseHalfLifeDays: 30, emotionHalfLifeDays: 7,
    wBaseline: 0.05, wActivation: 0.45, wImportance: 0.35, wEmotion: 0.15,
    injectTop: 3, recallMinC: 0.15, reinforce: 0.2, maxPerPeer: 500, recordUserMsgs: true,
    injectChars: 300, autoExtract: true, recallTop: 3, ttlDays: 180,
  },
  profile: { enabled: true, traitTtlDays: 60, dailyAt: '03:00', minMsgs7d: 20, windowDays: 7, traitsMax: 5, speedTop: 5, speedChars: 120, sealDays: 180, notifyGroup: false, llmInduce: false, llmProvider: '', llmModel: '' },
  // 心情 v2：七情六欲 + 复合情绪，只改语气
  mood: { v2Enabled: true, injectChars: 120 },
  // 自主循环（默认只提议，批准后才跑；动作只在本机）
  autonomy: { enabled: true, proposePerDay: 2, autoInternal: true },
  // MCP 可选层：默认关；服务器在 settings.json 的 mcp.servers 里配
  mcp: { enabled: false, servers: [] },
  // 反八股：出站前检测一次，重写一次，还不行就降级
  anti8gu: { enabled: true, maxScore: 2, maxChars: 120 },
  sticker: {
    enabled: true, perTurnMax: 1, perGroupDay: 20, dedupeHours: 24,
    collectEnabled: true, collectTtlDays: 30, collectPerGroupDay: 30, genPerGroupDay: 2, collectMaxPx: 640,
    remoteSource: 'https://fisharchive.cc/stickers/index.json',
    remoteSources: [], autoSyncDays: 1,
    genProvider: { baseUrl: '', apiKey: '', model: 'flux-schnell', size: '512x512' },
    maxPerMsgMB: 2,
  },
  order: { autoRecallDelaySec: 300, muteMaxSec: 600, muteDefaultSec: 600, mutePerHour: 3, autoRecallEnabled: false, autoRecallKeywords: [], muteTemplate: '好，{n} 分钟内我不说话。（#说话 可解除）' },
  bili: {
    pushEnabled: false, pollMinutes: 5, pushPerGroupDay: 100,
    parseEnabled: true, sizeBudgetMB: 30, minHeight: 360, clipEnabled: false, clipSeconds: 60,
    quality: 480, clipFrom: 0, pushCover: true, pushTemplate: '【B站动态】{author}\\n{text}\\n{link}', cookie: '', ups: [],
  },
  usage: {
    groupDailyTokens: 800000, userDailyTokens: 300000, warnRatio: 0.8,
    // 与 lib/usage.js 的 DEFAULT_PRICES 保持一致（官方 deepseek-flash 峰时价）
    calibFactor: 0.15,
    priceInputMiss: 2, priceInputHit: 0.04, priceOutput: 8,
    // 空闲价：留 0 = 按「谷时计价系数」自动折算（默认半价）；填了就按填的算
    priceOffPeakInputMiss: 0, priceOffPeakInputHit: 0, priceOffPeakOutput: 0,
    priceOffPeakFactor: 0.5,
    peakWindows: ['09:00-12:00', '14:00-18:00'],
    peakOnlyWeekdays: true,
    holidays: [],
    priceSearch: 0.005, searchFreeUntil: '2026-11-01T00:00:00+08:00',
    mealPrice: 0.01,
    payQrEnabled: false, payQrPath: '', payQrDir: '',
    // 实时充值码：专用浏览器现开现截（登录态在 <数据目录>/pay-browser）
    payLiveEnabled: false, payLivePort: 9333, payLiveMethod: 'wechat', payLiveAutoStart: true, payLiveKeepOpen: false,
    payLiveUrl: 'https://platform.deepseek.com/top_up', payLiveAmount: 10, payLiveWaitSec: 20,
    rechargeMaxOnce: 20, rechargeDailyCap: 50, rechargeUserDailyCap: 0,
    groupDailyYuan: 3, userDailyYuan: 1,
    hardLimitEnabled: false, dailyYuanHardLimit: 2, onExceed: 'degrade', warnAt: 0.8,
  },
  ui: { helpCard: true, markers: true, plainText: true },
  /** 大文件（whisper 模型 / ffmpeg）落地目录；留空 = <数据目录>/downloads */
  paths: { downloadsDir: '' },
  tools: { enableGate: true, gateExisting: false, fullAccess: false, ownerFullAccess: true, mode: 'allowlist', allowForMembers: ['web_search', 'todo_write'], restrictToWorkspace: true, workspaceRoots: [], permissionLevel: 'standard', imagePerGroupDay: 20, computerUse: 'read' },
  integration: {
    linkMood: true, linkMoodVoice: true, linkMoodProbability: true, moodInPrompt: true, moodProactive: true,
    // 心情只有本地一个来源（P1 起不再读第三方插件）
    llmEnabled: false, llmProvider: '', llmModel: '', llmEvery: 20, llmDailyTokens: 20000,
  },
  learn: { enabled: true, injectRules: true, allowAdmin: false },
  knowledge: { enabled: true, injectChars: 400 },
  transport: { mode: 'tencent', onebot: { url: 'ws://127.0.0.1:3001', token: '', cwd: '', quoteReply: true, contextLines: 6, vision: true, maxImages: 2, maxImageMB: 8 }, rosterRefreshHours: 6 },
  safety: { profile: 'normal' },
  fix: { enabled: true, repo: 'D:\\work\\dsh-qqbot-refine\\dsh-qqbot-refine' },
  draw: { enabled: true, members: true, natural: true, confirm: true, confirmMode: 'smart', character: 'auto', search: false, pendingSec: 90, refDenoise: 0.6, width: 512, height: 768, steps: 22, perGroupHour: 3, perUserDay: 2, comfyRoot: 'D:\\ComfyUI', timeoutMs: 240000 },
  esports: { enabled: true, leagueId: '', leagues: [], hl: 'zh-CN', sources: ['lolesports', 'opgg'], refreshHours: 6, lookAheadDays: 7 },
  memGuard: { killList: [] },
  stt: { enabled: false, command: '', timeoutMs: 30000 },
  proactive: {
    enabled: false, mode: 'template', silentMinutes: 12, minGapMinutes: 45,
    dailyPerGroup: 6, maxChars: 60, useMemory: true, llmProvider: '', llmModel: '', llmOnlyWithMemory: true,
  },
  voice: {
    enabled: false, baseUrl: 'http://127.0.0.1:9880', apiKey: '', voiceId: 'feiyu',
    style: 'cute', maxChars: 120, pollTimeoutSec: 60, autoRead: false, perGroupHour: 10,
  },
}

export const FIELDS = [
  { k: 'scope.groups', t: 'list', l: '白名单群 openid', tab: 'scope', hint: '一行一个；群里发 #绑定本群 自动记下' },
  { k: 'scope.dmUsers', t: 'list', l: '白名单私聊用户 openid', tab: 'scope' },
  { k: 'roles.owners', t: 'list', l: 'Owner openid', tab: 'scope', hint: '最高权限' },
  { k: 'roles.admins', t: 'list', l: '手动 Admin openid', tab: 'scope' },
  { k: 'roles.adminAutoFromQqOwner', t: 'bool', l: 'QQ 群主/群管自动成为 Admin', tab: 'scope' },
  { k: 'frequency.mentionOnlyGroups', t: 'bool', l: '群聊仅 @ 才回', tab: 'freq' },
  { k: 'frequency.quietEnabled', t: 'bool', l: '启用免打扰时段', tab: 'freq' },
  { k: 'frequency.quietStart', t: 'text', l: '免打扰开始 (HH:MM)', tab: 'freq' },
  { k: 'frequency.quietEnd', t: 'text', l: '免打扰结束 (HH:MM)', tab: 'freq' },
  { k: 'frequency.naturalMode', t: 'bool', l: '群对话：自然接话模式', tab: 'freq', hint: '关=只回 @；开=像群里的人一样会接话' },
  { k: 'frequency.triggerAlias', t: 'bool', l: '　触发①：叫到小名就接', tab: 'freq', hint: '小名列表在下面' },
  { k: 'frequency.fitJudge', t: 'bool', l: '　判定：先看她是不是在跟她说话 / 话题适不适合', tab: 'freq', hint: '关掉=只要触发了就接，不再过滤' },
  { k: 'frequency.directThreshold', t: 'num', l: '　「在对她说」阈值（0～1）', tab: 'freq', min: 0, max: 1, step: 0.05 },
  { k: 'frequency.fitThreshold', t: 'num', l: '　「话题适合」阈值（0～1）', tab: 'freq', min: 0, max: 1, step: 0.05 },
  { k: 'frequency.fitTopics', t: 'list', l: '　话题相关词（留空=内置词表）', tab: 'freq' },
  { k: 'frequency.fitNegative', t: 'list', l: '　不接话的负面词（留空=内置）', tab: 'freq' },
  { k: 'frequency.aliases', t: 'list', l: '她的小名/触发词（一行一个）', tab: 'freq', hint: '文本里出现这些词就算被点名' },
  { k: 'frequency.ownerPriority', t: 'select', l: '群里对 Owner 的优先度', tab: 'freq', options: [{ v: 'always', l: '最高：你说就回（不占频率/冷却）' }, { v: 'high', l: '高：冷却减半，但仍判断「是不是在跟她说话」' }, { v: 'normal', l: '普通：和别人完全一样' }], hint: '只影响频率/接话判定，不影响安全与花费闸；嫌她太黏就选 high 或 normal' },
  { k: 'frequency.stickyMin', t: 'num', l: '刚聊过的话题更容易接（分钟）', tab: 'freq', min: 0, max: 60 },
  { k: 'frequency.selfGapSec', t: 'num', l: '她说完后静默（秒）', tab: 'freq', min: 0, max: 600, hint: '只对「没叫她」的消息生效；叫小名/接续对话不受这条限制' },
  { k: 'frequency.chainWindowSec', t: 'num', l: '连续对话窗口（秒）', tab: 'freq', min: 0, max: 600, hint: '同一个人在她回话后这么久内接着说 → 当成还在跟她聊，不被冷却挡' },
  { k: 'frequency.maxRepliesPerTurn', t: 'num', l: '单轮最多发几条（也是分段上限）', tab: 'freq', min: 1, max: 10 },
  { k: 'frequency.splitMinChars', t: 'num', l: '　超过多少字才拆成几条', tab: 'freq', min: 10, max: 500 },
  { k: 'frequency.typingEnabled', t: 'bool', l: '像人一样「打字」再发（按字数延迟）', tab: 'freq' },
  { k: 'frequency.typingMsPerChar', t: 'num', l: '　每字打字时间（毫秒）', tab: 'freq', min: 5, max: 120 },
  { k: 'frequency.typingMaxMs', t: 'num', l: '　单条最长延迟（毫秒）', tab: 'freq', min: 200, max: 10000 },
  { k: 'privacy.enabled', t: 'bool', l: '隐私闸总开关', tab: 'privacy' },
  { k: 'privacy.redactOutbound', t: 'bool', l: '出站脱敏', tab: 'privacy', hint: '回复发出前替换密钥/路径/模型名等' },
  { k: 'privacy.defaultRules', t: 'bool', l: '启用内置脱敏规则', tab: 'privacy', hint: '手机号·身份证·银行卡·邮箱·内网IP·密钥·本机路径·模型名' },
  { k: 'privacy.blockBuiltin', t: 'bool', l: '启用内置拦截词', tab: 'privacy', hint: '「身份证号」「你的密钥」这类索要隐私的问法直接丢弃；Owner 豁免' },
  { k: 'privacy.blockKeywords', t: 'list', l: '自定义丢弃词（一行一个）', tab: 'privacy', hint: '命中即整条丢弃，连模型都看不到' },
  { k: 'privacy.redactKeywords', t: 'list', l: '自定义脱敏词（一行一个）', tab: 'privacy', hint: '出现即替换为 [已隐藏]' },
  { k: 'privacy.memoryRedact', t: 'bool', l: '记忆入库前脱敏', tab: 'privacy', hint: '手机号/卡号等不进记忆库' },
  { k: 'privacy.guardPrompts', t: 'bool', l: '防套话 / 提示注入', tab: 'privacy', hint: '非 Owner 问密钥/配置/路径/模型，或试图改指令 → 拦下' },
  { k: 'privacy.guardMode', t: 'text', l: '拦截方式（reply / drop）', tab: 'privacy', hint: 'reply=回一句固定话术（0 token）；drop=完全静默' },
  { k: 'privacy.guardReply', t: 'text', l: '固定话术', tab: 'privacy' },
  { k: 'privacy.inboundMedia', t: 'text', l: '入站媒体（allow / allowlistOnly / deny）', tab: 'privacy', hint: 'allowlistOnly=只收白名单来源的图片/文件' },
  { k: 'privacy.fileRoots', t: 'list', l: '允许外发的文件根目录', tab: 'privacy', hint: '留空=只允许 tmp/图库/生成物' },
  { k: 'privacy.fileMaxMB', t: 'num', l: '外发文件大小上限（MB）', tab: 'privacy', min: 1, max: 200 },
  { k: 'privacy.auditDays', t: 'num', l: '审计日志保留（天）', tab: 'privacy', min: 1, max: 365 },
  { k: 'identity.enabled', t: 'bool', l: '启用身份内核注入（内核/场景/风格/自我一段）', tab: 'identity', hint: '关掉=完全不注入身份段，只留上下文' },
  { k: 'identity.takeover', t: 'bool', l: '身份系统接管（关=回滚，不注入身份段）', tab: 'identity', hint: '出问题一键回滚：跟 identity.enabled 一起判断，任意一个关掉就不注入' },
  { k: 'identity.maxChars', t: 'num', l: '身份段字数硬上限', tab: 'identity', min: 300, max: 2000, step: 50, hint: '稳定在前、易变在后；超了从后面的动态段开始截' },
  { k: 'identity.traitsMax', t: 'num', l: '注入几条 durable traits（有证据的自我）', tab: 'identity', min: 0, max: 10 },
  { k: 'identity.baseText', t: 'text', l: '内核（全部可改，含底线；代码级安全另算）', tab: 'identity', hint: '留空=用内置内核；这里写的会作为「她是谁」的底座，traits/情绪只在她之上生长' },
  { k: 'persona.scale', t: 'range', l: '聊天尺度（保守 ↔ 放飞）', tab: 'identity', min: 0, max: 100, step: 5, hint: '只影响语气与放开程度：低=克制礼貌；高=会接梗、会损人、允许脏话；事实与安全底线不随它变' },
  { k: 'memory.auto', t: 'bool', l: '自动记忆（聊天里第一人称陈述自动记）', tab: 'memory', hint: '只认「我住…」「我喜欢…」这类明确说法；问句、玩笑不记' },
  { k: 'memory.autoPerDay', t: 'num', l: '自动记忆每群每日上限', tab: 'memory', min: 0, max: 100 },
  { k: 'memory.enabled', t: 'bool', l: '启用长期记忆', tab: 'memory' },
  { k: 'memory.wBaseline', t: 'num', l: '记忆权重：基线项', tab: 'memory', min: 0, max: 1, step: 0.01, hint: '召回分 = 基线×wB + 鲜活×wA + 重要×wI + 情绪×wE' },
  { k: 'memory.recordUserMsgs', t: 'bool', l: '群内用户发言也记', tab: 'memory' },
  { k: 'memory.baseHalfLifeDays', t: 'num', l: '基础半衰期（天）', tab: 'memory', min: 15, max: 60 },
  { k: 'memory.emotionHalfLifeDays', t: 'num', l: '情绪半衰期（天）', tab: 'memory', min: 3.5, max: 14, step: 0.5 },
  { k: 'memory.injectTop', t: 'num', l: '每轮注入条数', tab: 'memory', min: 1, max: 6 },
  { k: 'memory.recallMinC', t: 'num', l: '注入门槛（相关度 C）', tab: 'memory', min: 0.05, max: 0.5, step: 0.01 },
  { k: 'memory.reinforce', t: 'num', l: '强化系数', tab: 'memory', min: 0.1, max: 0.4, step: 0.05 },
  { k: 'memory.maxPerPeer', t: 'num', l: '每 peer 容量', tab: 'memory', min: 50, max: 2000 },
  { k: 'profile.enabled', t: 'bool', l: '启用群成员画像', tab: 'profile' },
  { k: 'profile.dailyAt', t: 'text', l: '每日归纳时刻 (HH:MM)', tab: 'profile' },
  { k: 'profile.minMsgs7d', t: 'num', l: '最少发言条数才建画像', tab: 'profile', min: 1, max: 200 },
  { k: 'profile.windowDays', t: 'num', l: '统计窗口（天）', tab: 'profile', min: 1, max: 90 },
  { k: 'profile.traitsMax', t: 'num', l: '每人特质上限（条）', tab: 'profile', min: 1, max: 10 },
  { k: 'profile.speedTop', t: 'num', l: '速写注入人数（Top N）', tab: 'profile', min: 1, max: 10 },
  { k: 'profile.speedChars', t: 'num', l: '速写每人字数上限', tab: 'profile', min: 40, max: 400 },
  { k: 'profile.traitTtlDays', t: 'num', l: '画像标签过期天数', tab: 'profile', min: 7, max: 365, hint: '超过这个天数没再出现的标签会自动掉' },
  { k: 'profile.sealDays', t: 'num', l: '长期不发言自动清除（天）', tab: 'profile', min: 30, max: 720, hint: '（暂未生效，先占位）' },
  { k: 'profile.notifyGroup', t: 'bool', l: '画像更新时在面板提示（默认关）', tab: 'profile', hint: '只在面板「认知 · 画像」显示一条提示，不会往群里发；要群里通知就把这里打开（独立消息，不引用别人）' },
  { k: 'sticker.enabled', t: 'bool', l: '启用表情包', tab: 'sticker' },
  { k: 'sticker.perTurnMax', t: 'num', l: '每轮最多几张', tab: 'sticker', min: 0, max: 3 },
  { k: 'sticker.perGroupDay', t: 'num', l: '每群每日发送上限', tab: 'sticker', min: 0, max: 200 },
  { k: 'sticker.dedupeHours', t: 'num', l: '同图冷却（小时）', tab: 'sticker', min: 0, max: 168 },
  { k: 'sticker.collectEnabled', t: 'bool', l: '白名单群自动收集', tab: 'sticker' },
  { k: 'sticker.collectTtlDays', t: 'num', l: '收集图 TTL（天）', tab: 'sticker', min: 1, max: 365 },
  { k: 'sticker.collectPerGroupDay', t: 'num', l: '每群每日收集上限', tab: 'sticker', min: 0, max: 200 },
  { k: 'sticker.genPerGroupDay', t: 'num', l: '每群每日自生成上限', tab: 'sticker', min: 0, max: 20 },
  { k: 'sticker.collectMaxPx', t: 'num', l: '收集图最大边长（像素）', tab: 'sticker', min: 100, max: 2000, hint: '超过就当成截图不收集（默认 640）；长宽比 > 2.4 也不收' },
  { k: 'sticker.remoteSources', t: 'list', l: '远程图库索引（一行一个，可加多个）', tab: 'sticker', hint: '留空则用内置的 fisharchive 源' },
  { k: 'order.autoRecallDelaySec', t: 'num', l: '自动撤回延迟（秒）', tab: 'order', min: 0, max: 3600 },
  { k: 'order.muteMaxSec', t: 'num', l: '单次禁言上限（秒）', tab: 'order', min: 60, max: 86400 },
  { k: 'order.muteDefaultSec', t: 'num', l: '闭麦默认时长（秒）', tab: 'order', min: 60, max: 7200 },
  { k: 'order.mutePerHour', t: 'num', l: 'Admin 每小时闭麦次数', tab: 'order', min: 0, max: 20 },
  { k: 'roles.adminMaxMutePerDay', t: 'num', l: 'Admin 每日禁言次数', tab: 'order', min: 0, max: 100 },
  { k: 'roles.adminMaxRecallPerDay', t: 'num', l: 'Admin 每日撤回次数', tab: 'order', min: 0, max: 100 },
  { k: 'bili.pushEnabled', t: 'bool', l: 'B站动态推送', tab: 'bili' },
  { k: 'bili.pollMinutes', t: 'num', l: '轮询间隔（分钟）', tab: 'bili', min: 1, max: 60 },
  { k: 'bili.pushPerGroupDay', t: 'num', l: '每群每日推送上限', tab: 'bili', min: 0, max: 500 },
  { k: 'bili.parseEnabled', t: 'bool', l: 'B站链接解析', tab: 'bili' },
  { k: 'bili.sizeBudgetMB', t: 'num', l: '视频体积预算（MB）', tab: 'bili', min: 5, max: 200 },
  { k: 'bili.minHeight', t: 'num', l: '最低画质高度', tab: 'bili', min: 240, max: 1080 },
  { k: 'bili.clipEnabled', t: 'bool', l: '长视频截取', tab: 'bili' },
  { k: 'bili.clipSeconds', t: 'num', l: '截取时长（秒）', tab: 'bili', min: 10, max: 600 },
  { k: 'bili.ups', t: 'list', l: '订阅的 UP 主 mid（一行一个）', tab: 'bili' },
  { k: 'usage.hardLimitEnabled', t: 'bool', l: '花费硬闸（超了就停，不只是记录）', tab: 'usage', hint: '默认关；打开后按下面的每日上限拦截' },
  { k: 'usage.dailyYuanHardLimit', t: 'num', l: '　每日上限（元）', tab: 'usage', min: 0, max: 1000, step: 0.5 },
  { k: 'usage.onExceed', t: 'select', options: [{ v: 'degrade', l: 'degrade · 降级回模板' }, { v: 'mute', l: 'mute · 直接静默' }], l: '　超限动作', tab: 'usage', hint: 'degrade=不再调模型，回一句 0 token 的话；mute=直接不回' },
  { k: 'usage.warnAt', t: 'num', l: '　提醒阈值（占上限比例）', tab: 'usage', min: 0.1, max: 1, step: 0.05 },
  { k: 'usage.groupDailyYuan', t: 'num', l: '每群每日预算（软，只告警）', tab: 'usage', min: 0, max: 1000, step: 0.5, hint: '按下面的单价折算，超了在面板 #用量 里标红' },
  { k: 'usage.userDailyYuan', t: 'num', l: '每人每日预算（元）', tab: 'usage', min: 0, max: 1000, step: 0.5, hint: '（暂未生效，先占位）' },
  { k: 'usage.priceInputMiss', t: 'num', l: '单价：输入未命中（元/百万 tokens）', tab: 'usage', min: 0, max: 100, step: 0.1 },
  { k: 'usage.priceInputHit', t: 'num', l: '单价：输入命中缓存（元/百万 tokens）', tab: 'usage', hint: '以上三条是**高峰价**' },
  { k: 'usage.priceOffPeakInputMiss', t: 'num', l: '空闲价：输入未命中（留 0 = 按系数折算）', tab: 'usage', min: 0, max: 100, step: 0.01 },
  { k: 'usage.priceOffPeakInputHit', t: 'num', l: '空闲价：输入命中缓存（留 0 = 按系数折算）', tab: 'usage', min: 0, max: 100, step: 0.01 },
  { k: 'usage.priceOffPeakOutput', t: 'num', l: '空闲价：输出（留 0 = 按系数折算）', tab: 'usage', min: 0, max: 100, step: 0.01 },
  { k: 'usage.priceOffPeakFactor', t: 'num', l: '谷时计价系数（没填空闲价时用它，0.5 = 五折）', tab: 'usage', min: 0.1, max: 1, step: 0.05 },
  { k: 'usage.peakWindows', t: 'list', l: '高峰时段（北京时间，逗号分隔）', tab: 'usage', hint: '官方：工作日 09:00-12:00、14:00-18:00；其余（含周末/节假日）按空闲价' },
  { k: 'usage.peakOnlyWeekdays', t: 'bool', l: '周末整段算空闲', tab: 'usage', hint: '关掉就只按上面的时段判断' },
  { k: 'usage.holidays', t: 'list', l: '按空闲价算的节假日（YYYY-MM-DD，一行一个）', tab: 'usage', hint: '官方节假日也走空闲价；只影响峰谷记账，不影响模型' },
  { k: 'usage.priceSearch', t: 'num', l: '联网搜索单价（元/次）', tab: 'usage', min: 0, max: 1, step: 0.01 },
  { k: 'usage.mealPrice', t: 'num', l: '一碗饭 ≈ 多少钱（比喻用）', tab: 'usage', min: 0.001, max: 1, step: 0.001 },
  { k: 'usage.payQrEnabled', t: 'bool', l: '允许发收款码（开关）', tab: 'usage', hint: '关着就一直不发；开了也要配好图片路径' },
  { k: 'usage.payQrDir', t: 'text', l: '收款码文件夹（没配固定路径时，发里面最新的一张）', tab: 'usage', hint: '订单码会过期，可以把最新截图存这里，她自动发最新那张' },
  { k: 'usage.payQrPath', t: 'text', l: '收款码图片路径（本机绝对路径）', tab: 'usage' },
  { k: 'usage.payLiveEnabled', t: 'bool', l: '实时充值码（现开 DeepSeek 充值页，截当次二维码）', tab: 'usage', hint: '需要先跑 scripts/pay-browser.ps1 并登录一次；关着就走上面的静态收款码' },
  { k: 'usage.payLivePort', t: 'num', l: '　专用浏览器调试端口', tab: 'usage', min: 1024, max: 65535, hint: '默认 9333，和 pay-browser.ps1 里一致' },
  { k: 'usage.payLiveMethod', t: 'select', options: [{ v: 'wechat', l: '微信支付' }, { v: 'alipay', l: '支付宝' }], l: '　支付方式', tab: 'usage', hint: '微信会直接在页面上出二维码；支付宝可能跳新页面（失败会回落静态码）' },
  { k: 'usage.payLiveAutoStart', t: 'bool', l: '　浏览器没开就自动拉起来', tab: 'usage', hint: '用完自动关闭（除非打开下面的保持开关）' },
  { k: 'usage.payLiveKeepOpen', t: 'bool', l: '　用完后保持浏览器打开', tab: 'usage', hint: '默认关：用完就关；开着会一直占内存' },
  { k: 'usage.payLiveUrl', t: 'text', l: '　充值页地址', tab: 'usage' },
  { k: 'usage.payLiveAmount', t: 'num', l: '　默认充多少（元）', tab: 'usage', min: 1, max: 5000 },
  { k: 'usage.payLiveWaitSec', t: 'num', l: '　等二维码最长几秒', tab: 'usage', min: 5, max: 120 },
  { k: 'usage.rechargeMaxOnce', t: 'num', l: '单次充饭钱上限（元）', tab: 'usage', min: 1, max: 200 },
  { k: 'usage.rechargeDailyCap', t: 'num', l: '每日充饭钱总额上限（元）', tab: 'usage', min: 1, max: 500 },
  { k: 'usage.rechargeUserDailyCap', t: 'num', l: '　每人每天最多充多少（元）', tab: 'usage', min: 0, max: 200, hint: '0 = 不限；防止一个人把当天总额度占满' },
  { k: 'usage.calibFactor', t: 'num', l: '校准系数（默认 0.15：宿主上报的 cacheRead 约为上下文的 6-7 倍，按此折算接近后台账单）', tab: 'usage', min: 0.01, max: 20, step: 0.01 },
  { k: 'usage.priceOutput', t: 'num', l: '单价：输出（元/百万 tokens）', tab: 'usage', min: 0, max: 100, step: 0.1 },
  { k: 'usage.groupDailyTokens', t: 'num', l: '每群每日 token 预算（旧口径）', tab: 'usage', min: 0, max: 5000000, hint: '（暂未生效，先占位）' },
  { k: 'usage.userDailyTokens', t: 'num', l: '每人每日 token 预算', tab: 'usage', min: 0, max: 5000000, hint: '（暂未生效，先占位）' },
  { k: 'usage.warnRatio', t: 'num', l: '预算告警比例', tab: 'usage', min: 0.1, max: 1, step: 0.05, hint: '（暂未生效，先占位）' },
  { k: 'proactive.enabled', t: 'bool', l: '启用主动搭话', tab: 'proactive', hint: '群里久没人说话时她主动开口（受闭麦/免打扰/频率约束）' },
  { k: 'proactive.mode', t: 'text', l: '模式（template / hybrid / llm）', tab: 'proactive', hint: 'template=0 token；hybrid=模板打底+模型润色（推荐）；llm=纯模型生成' },
  { k: 'proactive.llmOnlyWithMemory', t: 'bool', l: 'hybrid 时：有记忆话题才动用模型', tab: 'proactive', hint: '省钱：没话题就纯模板' },
  { k: 'proactive.silentMinutes', t: 'num', l: '群里安静多少分钟后（等话头停下）', tab: 'proactive', min: 5, max: 1440, hint: '像人一样：等到话题自然停下来，不是定时打卡' },
  { k: 'proactive.minGapMinutes', t: 'num', l: '两次主动最小间隔（分钟）', tab: 'proactive', min: 10, max: 1440, hint: '别追着说；有理由才开口' },
  { k: 'proactive.dailyPerGroup', t: 'num', l: '每群每日上限', tab: 'proactive', min: 0, max: 20 },
  { k: 'proactive.useMemory', t: 'bool', l: '允许顺口问一句记忆里的事', tab: 'proactive' },
  { k: 'proactive.llmProvider', t: 'text', l: 'llm 模式 provider', tab: 'proactive', hint: '留空则只用模板' },
  { k: 'proactive.llmModel', t: 'text', l: 'llm 模式 model', tab: 'proactive' },
  { k: 'tools.enableGate', t: 'bool', l: '启用工具调用闸门', tab: 'privacy', hint: '排查用：关掉=不包任何工具' },
  { k: 'tools.gateExisting', t: 'bool', l: '连启动时已注册的工具也包', tab: 'privacy', hint: '默认关：只包之后注册的，避免误包内部对象' },
  { k: 'tools.ownerFullAccess', t: 'bool', l: '群聊里对 Owner 放开全部工具（危险命令仍拦）', tab: 'privacy', hint: '只认「这一轮说话的人是不是 Owner」；别人照旧只读。⚠ 开了之后你 @ 她就能让她跑命令/改文件' },
  { k: 'tools.fullAccess', t: 'bool', l: '给 AI 全部权限（工具/路径/套话拦截全放开）', tab: 'privacy', hint: '只保留「真实凭据兜底」；打开后群里任何人也能用工具，谨慎' },
  { k: 'tools.permissionLevel', t: 'text', l: '权限档位（strict / standard / open）', tab: 'privacy', hint: '面板上有三个按钮，点一下整组切换' },
  { k: 'privacy.blockDangerIntent', t: 'bool', l: '拦危险动作意图（读文件/执行命令）', tab: 'privacy' },
  { k: 'privacy.hardSecrets', t: 'bool', l: '真实凭据兜底（apiKey/appSecret 原文不出现）', tab: 'privacy', hint: '建议一直开' },
  { k: 'tools.mode', t: 'text', l: 'QQ 群里的工具策略（allowlist / owner-only / open）', tab: 'privacy', hint: 'allowlist=只放行下面白名单；owner-only=群内全禁；open=不限制（不建议）' },
  { k: 'tools.allowForMembers', t: 'list', l: '群内允许的工具（一行一个）', tab: 'privacy' },
  { k: 'tools.restrictToWorkspace', t: 'bool', l: '工具只能访问工作区内的文件', tab: 'privacy', hint: '越界路径（如 ~/.dsh、其它盘）一律拒绝' },
  { k: 'tools.workspaceRoots', t: 'list', l: '额外允许的根目录', tab: 'privacy', hint: '留空=只允许当前工作区 + 插件临时目录（qqbot 的 ~/.dsh-qqbot/media 始终允许）' },
  { k: 'tools.imagePerGroupDay', t: 'num', l: '每组每日看图上限', tab: 'privacy', min: 0, max: 200, hint: '图片很贵：默认 20 次/天/群；同一张图 30 分钟内不重复看；0=不限制' },
  { k: 'tools.computerUse', t: 'select', options: [{ v: 'off', l: 'off · 群成员不能用' }, { v: 'read', l: 'read · 只看不动（截图/列窗口）' }, { v: 'full', l: 'full · 能点能打字（危险）' }], l: '群成员能不能操控电脑（dsh-computer-use-win）', tab: 'privacy', hint: '只对 windows_computer_use_* 生效；Owner 一直可用。read=截图/列窗口/读控件树；full=点击、输入、拖拽' },
  { k: 'ui.helpCard', t: 'bool', l: '#帮助 用卡片图（0 token）', tab: 'usage', hint: '关掉则回到纯文本' },
  { k: 'ui.plainText', t: 'bool', l: '去掉 AI 排版（加粗/标题/列表）再发', tab: 'usage', hint: '群里只看得懂纯文本' },
  { k: 'ui.markers', t: 'bool', l: '在系统提示里附上标记说明', tab: 'usage', hint: '让模型知道可以用 [[sticker:auto]] / [[remember: 要点]] / [[recall: 词]] / [[voice: 文本]]' },
  { k: 'anti8gu.enabled', t: 'bool', l: '反八股（检测 → 重写一次 → 降级）', tab: 'identity', hint: '0 token，本地：禁助理腔/分点作文/markdown 排版；改不了事实，只改说法' },
  { k: 'anti8gu.maxScore', t: 'num', l: '　判定阈值（命中越多越像稿子）', tab: 'identity', min: 1, max: 10 },
  { k: 'autonomy.enabled', t: 'bool', l: '自主循环（只提议，批准后才跑；只在本机）', tab: 'proactive', hint: '好奇→目标→计划→治理→执行→验收→记录→反思；模型只能提议，Owner 用 #批准 才动' },
  { k: 'autonomy.autoInternal', t: 'bool', l: '内部动作自动批准（只读/自我提醒；对外仍需你批）', tab: 'proactive' },
  { k: 'autonomy.proposePerDay', t: 'num', l: '　每组每天最多提议几个目标', tab: 'proactive', min: 0, max: 10 },
  { k: 'mood.v2Enabled', t: 'bool', l: '心情 v2（七情六欲 + 复合情绪）', tab: 'mood', hint: '本地 0 token；只改语气，不改事实/边界/收费/安全。复合情绪：别扭/得意/忐忑/委屈/抗拒' },
  { k: 'mood.injectChars', t: 'num', l: '　心情段注入字数上限', tab: 'mood', min: 40, max: 400, step: 10 },
  { k: 'integration.linkMood', t: 'bool', l: '心情总开关', tab: 'mood', hint: '总闸：关掉后下面 4 项全部失效，她不再受心情影响。心情由本地引擎从群聊信号计算（零依赖、不读任何插件文件）' },
  { k: 'integration.linkMoodProbability', t: 'bool', l: '　心情影响接话概率', tab: 'mood', hint: '心情 0→0.5 倍，50→1 倍，100→1.5 倍' },
  { k: 'integration.linkMoodVoice', t: 'bool', l: '　心情决定语音风格', tab: 'mood', hint: '高=cute，低/难过=gentle' },
  { k: 'integration.moodInPrompt', t: 'bool', l: '　心情影响语气（写进人设提示）', tab: 'mood', hint: '只给数值和语气建议，不带主会话里聊过的具体事' },
  { k: 'integration.moodProactive', t: 'bool', l: '　心情影响主动搭话频率', tab: 'mood', hint: '心情好更爱开口，低落时更安静' },
  { k: 'integration.llmEnabled', t: 'bool', l: '　用模型读群聊评估心情（花 token）', tab: 'mood', hint: '攒够条数才调一次，输出七维情绪增量；失败不影响聊天；理由只落面板，不进群提示词' },
  { k: 'integration.llmProvider', t: 'text', l: '　　评估用 provider', tab: 'mood', hint: '留空 = 用宿主默认模型（和网页新会话同一个）' },
  { k: 'integration.llmModel', t: 'text', l: '　　评估用 model', tab: 'mood', hint: '留空 = 用宿主默认模型' },
  { k: 'integration.llmEvery', t: 'num', l: '　　每攒多少条消息评估一次', tab: 'mood', min: 5, max: 100 },
  { k: 'integration.llmDailyTokens', t: 'num', l: '　　每天评估预算（tokens）', tab: 'mood', min: 0, max: 200000, step: 1000, hint: '用完当天就不再调，第二天自动恢复' },
  { k: 'learn.enabled', t: 'bool', l: '会学习（本地，0 token）', tab: 'memory', hint: '学两件事：群主/管理员的规矩、这个群爱不爱接她的话' },
  { k: 'learn.injectRules', t: 'bool', l: '　把学到的规矩写进人设', tab: 'memory' },
  { k: 'learn.allowAdmin', t: 'bool', l: '　管理员也可以教规矩（默认只认 Owner）', tab: 'memory' },
  { k: 'transport.mode', t: 'select', l: '通道模式', tab: 'channel', options: [{ v: 'tencent', l: '官方 QQ（im-qqbot）' }, { v: 'onebot', l: 'NapCat / OneBot 11（推荐）' }], hint: '单活：改完需要重启 DSH。onebot=连 NapCat 的 websocketServers；顶栏也有同样的开关' },
  { k: 'transport.onebot.url', t: 'text', l: 'OneBot WS 地址', tab: 'channel', hint: '例如 ws://127.0.0.1:3001（NapCat 的 websocketServers）' },
  { k: 'transport.onebot.token', t: 'text', l: 'OneBot token', tab: 'channel', hint: '与 NapCat 里配置的一致；留空表示无鉴权' },
  { k: 'transport.onebot.quoteReply', t: 'bool', l: '群聊回复时引用原消息', tab: 'channel', hint: '关掉就发纯文本（不占引用额度，但看不出在回哪句）' },
  { k: 'transport.onebot.contextLines', t: 'num', l: '群聊上下文条数（短句自动翻倍）', tab: 'channel', min: 0, max: 30, hint: '0=不带上下文；短句/接话词会临时×2，上限 30' },
  { k: 'transport.onebot.cwd', t: 'text', l: 'QQ 会话工作目录', tab: 'channel', hint: '留空=宿主进程当前目录' },
  { k: 'transport.onebot.vision', t: 'bool', l: '把群里的图片真的发给模型看', tab: 'channel', hint: '开=下载图片并以图像内容投喂（需要宿主的 attachment 服务）；关=只留 [图片] 占位' },
  { k: 'transport.onebot.maxImages', t: 'num', l: '单条消息最多看几张图', tab: 'channel', min: 1, max: 4 },
  { k: 'transport.onebot.maxImageMB', t: 'num', l: '单张图大小上限（MB）', tab: 'channel', min: 1, max: 16 },
  { k: 'transport.rosterRefreshHours', t: 'num', l: '名册刷新间隔（小时）', tab: 'channel', min: 1, max: 72 },
  { k: 'safety.profile', t: 'select', options: [{ v: 'normal', l: 'normal（正常，推荐）' }, { v: 'safe', l: 'safe（每小时 30 / 每天 150 / 间隔 ≥8s）' }], l: '安全档位', tab: 'usage', hint: 'safe：每小时 30、每天 150、间隔 ≥8s、主动搭话关、私聊陌生人禁、图 ≤10/天' },
  { k: 'paths.downloadsDir', t: 'text', l: '大文件下载目录（whisper 模型 / ffmpeg）', tab: 'voice', hint: '留空 = <数据目录>/downloads。想放 D 盘就填绝对路径，例如 D:\\qqbot-assets（整个数据目录也能挪：scripts/move-data.ps1）' },
  { k: 'fix.enabled', t: 'bool', l: '允许「诊断→合并」流程（仅 Owner）', tab: 'draw' },
  { k: 'fix.repo', t: 'text', l: '补丁合并目标仓库', tab: 'draw', hint: '只允许对这个目录 git apply；其它路径不碰' },
  { k: 'draw.enabled', t: 'bool', l: '启用本地生图（ComfyUI）', tab: 'draw' },
  { k: 'draw.members', t: 'bool', l: '群友也能画（关=仅管理）', tab: 'draw' },
  { k: 'draw.confirmMode', t: 'select', l: '画之前怎么确认', tab: 'draw', options: [{ v: 'always', l: 'always · 每次先问' }, { v: 'smart', l: 'smart · 短而明确直接画（推荐）' }, { v: 'off', l: 'off · 全部直接画' }], hint: 'smart：≤30 字、没提「参考/像/风格」就直接生成；前缀 ! 永远直出' },
  { k: 'draw.character', t: 'select', l: '角色底子（大肥鱼形象）', tab: 'draw', options: [{ v: 'auto', l: 'auto · 提到她才套（推荐）' }, { v: 'lock', l: 'lock · 永远套' }, { v: 'free', l: 'free · 不套，只按描述画' }] },
  { k: 'draw.search', t: 'bool', l: '画之前联网搜一下（只加确认文案参考）', tab: 'draw' },
  { k: 'draw.refDenoise', t: 'num', l: '参考图重绘强度（0.2 像原图 / 0.9 只留构图）', tab: 'draw', min: 0.2, max: 0.9, step: 0.05 },
  { k: 'draw.pendingSec', t: 'num', l: '确认有效期（秒）', tab: 'draw', min: 20, max: 600 },
  { k: 'draw.natural', t: 'bool', l: '@她说「画个大肥鱼」也直接画', tab: 'draw', hint: '关掉就只能用 #画 命令' },
  { k: 'draw.width', t: 'num', l: '宽度', tab: 'draw', min: 256, max: 1024, step: 64 },
  { k: 'draw.height', t: 'num', l: '高度', tab: 'draw', min: 256, max: 1024, step: 64 },
  { k: 'draw.steps', t: 'num', l: '步数', tab: 'draw', min: 8, max: 50 },
  { k: 'draw.perGroupHour', t: 'num', l: '每群每小时上限', tab: 'draw', min: 0, max: 20 },
  { k: 'draw.perUserDay', t: 'num', l: '每人每天上限', tab: 'draw', min: 0, max: 20 },
  { k: 'draw.comfyRoot', t: 'text', l: 'ComfyUI 安装目录', tab: 'draw' },
  { k: 'esports.enabled', t: 'bool', l: '自动同步赛事赛程（LPL）', tab: 'matches' },
  { k: 'esports.refreshHours', t: 'num', l: '同步间隔（小时）', tab: 'matches', min: 1, max: 48 },
  { k: 'esports.lookAheadDays', t: 'num', l: '往后保留几天', tab: 'matches', min: 1, max: 30 },
  { k: 'esports.sources', t: 'list', l: '数据源顺序（一行一个）', tab: 'matches', hint: 'lolesports = 官方 API（推荐，含比分/时间）；opgg = 只能取赛段窗口' },
  { k: 'esports.leagueId', t: 'text', l: '联赛 ID（留空=全部赛程，含 Worlds）', tab: 'matches', hint: '留空最实用；只想要 LPL 就填 98767991314006698' },
  { k: 'esports.leagues', t: 'list', l: '只保留这些联赛（一行一个，留空=全部）', tab: 'matches', hint: '例如 Worlds / LPL / LCS' },
  { k: 'memGuard.killList', t: 'list', l: '「#清理」要杀的进程（一行一个）', tab: 'channel', hint: '留空用内置名单：discord / steam / steamwebhelper / BaiduNetdiskUnite / SillyTavern / msedgewebview2；保命进程永远不会被杀' },
  { k: 'stt.enabled', t: 'bool', l: '语音转写（要用外部命令）', tab: 'channel', hint: '开着才会尝试把语音转成文字；没配命令就只留 [语音] 占位' },
  { k: 'stt.command', t: 'text', l: '转写命令模板', tab: 'channel', hint: '例如 whisper-cli -m 模型.bin -f {file} -otxt -of {out}；{file}=音频路径，{out}=输出前缀' },
  { k: 'stt.timeoutMs', t: 'num', l: '转写超时（毫秒）', tab: 'channel', min: 2000, max: 120000, step: 1000 },
  { k: 'knowledge.enabled', t: 'bool', l: '群知识库（本地 markdown，命中才注入）', tab: 'memory', hint: '把资料丢进 storages/dsh-qqbot-refine/knowledge/：common.md 所有群共享，g_xxxx.md 只给那个群' },
  { k: 'knowledge.injectChars', t: 'num', l: '　每次最多注入多少字', tab: 'memory', min: 100, max: 2000, step: 50 },
  { k: 'voice.enabled', t: 'bool', l: '启用语音（需要本地声音服务）', tab: 'voice', hint: '服务来自 astrbot_plugin_feiyu_voice/server' },
  { k: 'voice.baseUrl', t: 'text', l: '声音服务地址', tab: 'voice', hint: '默认 http://127.0.0.1:9880' },
  { k: 'voice.apiKey', t: 'text', l: 'API Key（服务端 .runtime 里生成）', tab: 'voice' },
  { k: 'voice.voiceId', t: 'text', l: '声库 ID', tab: 'voice' },
  { k: 'voice.style', t: 'text', l: '风格（cute / gentle）', tab: 'voice' },
  { k: 'voice.maxChars', t: 'num', l: '单条朗读字数上限', tab: 'voice', min: 10, max: 300 },
  { k: 'voice.autoRead', t: 'bool', l: '每条回复自动念出来', tab: 'voice', hint: '会占 QQ 主动消息额度，建议配合每小时上限' },
  { k: 'voice.perGroupHour', t: 'num', l: '每群每小时语音上限', tab: 'voice', min: 0, max: 100 },
  { k: 'voice.pollTimeoutSec', t: 'num', l: '等声音服务超时（秒）', tab: 'voice', min: 10, max: 300 },

  { k: 'frequency.burstWindowSec', t: 'num', l: '突发窗口（秒）', tab: 'freq', min: 1, max: 60 },
  { k: 'frequency.burstCount', t: 'num', l: '突发窗口内上限', tab: 'freq', min: 1, max: 50 },
  { k: 'frequency.backoffSec', t: 'num', l: '超限退避（秒）', tab: 'freq', min: 0, max: 600 },
  { k: 'frequency.mergeWindowSec', t: 'num', l: '消息合并窗口（秒，0=关）', tab: 'freq', min: 0, max: 30 },
  { k: 'frequency.ignoreSelf', t: 'bool', l: '忽略机器人自己的回声', tab: 'freq' },

  { k: 'privacy.allowedHosts', t: 'list', l: '允许出现的外链主机', tab: 'privacy', hint: '留空=不限制；填写后只允许这些域名' },
  { k: 'privacy.blockLinks', t: 'bool', l: '丢弃含链接的消息', tab: 'privacy', hint: '（暂未生效，先占位）' },
  { k: 'privacy.newUserObserve', t: 'bool', l: '新人观察（发言不足前不建画像）', tab: 'privacy', hint: '（暂未生效，先占位）' },
  { k: 'privacy.redactNames', t: 'bool', l: '额外脱敏 @昵称', tab: 'privacy', hint: '（暂未生效，先占位）' },

  { k: 'memory.injectChars', t: 'num', l: '记忆卡字数上限', tab: 'memory', min: 80, max: 800 },
  { k: 'memory.autoExtract', t: 'bool', l: '自动提炼（[[remember]] 标记）', tab: 'memory' },
  { k: 'memory.recallTop', t: 'num', l: '召回条数上限', tab: 'memory', min: 1, max: 20 },
  { k: 'memory.ttlDays', t: 'num', l: '记忆最长保留（天）', tab: 'memory', min: 30, max: 720 },

  { k: 'profile.llmInduce', t: 'bool', l: '每日也跑一次语义归纳（调模型，默认关）', tab: 'profile', hint: '打开后：每天 dailyAt 先跑本地统计，再调模型补「性格/在意什么」这类需要理解的标签；要花一点 token，失败不影响本地结果' },
  { k: 'profile.llmProvider', t: 'text', l: '归纳用 provider', tab: 'profile', hint: '留空 = 用宿主默认模型（面板「语义归纳」直接可用）；填了才覆盖' },
  { k: 'profile.llmModel', t: 'text', l: '归纳用 model', tab: 'profile', hint: '留空 = 用宿主默认模型' },

  { k: 'sticker.maxPerMsgMB', t: 'num', l: '单张表情上限（MB）', tab: 'sticker', min: 1, max: 10, hint: '（暂未生效，先占位）' },
  { k: 'sticker.genProvider.baseUrl', t: 'text', l: '图像 provider Base URL', tab: 'sticker' },
  { k: 'sticker.genProvider.apiKey', t: 'text', l: '图像 provider API Key', tab: 'sticker', hint: '只存本地；面板不回显历史值' },
  { k: 'sticker.genProvider.model', t: 'text', l: '图像模型名', tab: 'sticker' },
  { k: 'sticker.genProvider.size', t: 'text', l: '生成尺寸（如 512x512）', tab: 'sticker' },

  { k: 'order.autoRecallEnabled', t: 'bool', l: '自动撤回（关键词命中）', tab: 'order' },
  { k: 'order.autoRecallKeywords', t: 'list', l: '自动撤回关键词', tab: 'order', hint: '（暂未生效，先占位）' },
  { k: 'order.muteTemplate', t: 'text', l: '闭麦回复模板（{n}=分钟）', tab: 'order' },

  { k: 'bili.quality', t: 'num', l: '默认画质（360/480/720/1080）', tab: 'bili', min: 360, max: 1080 },
  { k: 'bili.clipFrom', t: 'num', l: '截取起始秒', tab: 'bili', min: 0, max: 3600 },
  { k: 'bili.pushCover', t: 'bool', l: '推送带封面', tab: 'bili', hint: '（暂未生效，先占位）' },
  { k: 'bili.pushTemplate', t: 'text', l: '推送模板（{author}{text}{link}）', tab: 'bili', hint: '（暂未生效，先占位）' },
]

export const TABS = [
  ['scope', '白名单 / 层级'], ['freq', '频率'], ['privacy', '隐私'], ['identity', '身份'],
  ['cognition', '认知'], ['channel', '通道'],
  ['mood', '心情'], ['memory', '记忆'], ['profile', '画像'], ['sticker', '表情包'], ['order', '群秩序'],
  ['bili', 'B站'], ['draw', '生图'], ['voice', '语音'], ['proactive', '主动'], ['usage', '用量'],
  ['knowledge', '知识库'], ['matches', '赛程'],
]

export const FIELD_MAP = new Map(FIELDS.map((f) => [f.k, f]))
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

export function deepMerge(base, patch) {
  if (!isObj(base) || !isObj(patch)) return patch === undefined ? base : patch
  const out = { ...base }
  for (const [k, v] of Object.entries(patch)) out[k] = isObj(v) && isObj(base[k]) ? deepMerge(base[k], v) : v
  return out
}
export const clone = (v) => JSON.parse(JSON.stringify(v))

export function at(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj)
}
export function setAt(obj, path, value) {
  const keys = path.split('.')
  let cur = obj
  for (let i = 0; i < keys.length - 1; i++) {
    if (!isObj(cur[keys[i]])) cur[keys[i]] = {}
    cur = cur[keys[i]]
  }
  cur[keys[keys.length - 1]] = value
}

export function coerce(field, raw) {
  switch (field.t) {
    case 'bool': return Boolean(raw)
    case 'num': {
      const n = Number(raw)
      if (!Number.isFinite(n)) throw new Error(`${field.k} 需要数字`)
      return Math.min(field.max ?? Infinity, Math.max(field.min ?? -Infinity, n))
    }
    case 'list': {
      const arr = Array.isArray(raw) ? raw : String(raw ?? '').split(/[\r\n,，]/)
      return arr.map((s) => String(s).trim()).filter(Boolean)
    }
    default: return String(raw ?? '').trim()
  }
}

export function loadConfig() {
  let cfg
  try { cfg = deepMerge(clone(DEFAULTS), JSON.parse(readFileSync(CFG_PATH, 'utf8'))) } catch { return clone(DEFAULTS) }
  // 兼容旧配置：单源 remoteSource → 多源 remoteSources
  try {
    if ((!cfg.sticker.remoteSources || cfg.sticker.remoteSources.length === 0) && cfg.sticker.remoteSource) {
      cfg.sticker.remoteSources = [cfg.sticker.remoteSource]
    }
  } catch { /* ignore */ }
  return cfg
}
export function saveConfig(cfg) {
  // 防误清空：新配置同时清掉「群白名单」和「Owner」时拒绝写入（除非显式 FORCE）
  try {
    // 只保护「真实设置文件」（在用户 .dsh 下）；测试用临时目录不受影响
    const REAL = CFG_PATH.toLowerCase().includes('\\.dsh\\storages')
    if (REAL && process.env.QQBOT_REFINE_FORCE !== '1') {
      const cur = JSON.parse(readFileSync(CFG_PATH, 'utf8'))
      const hadScope = (cur?.scope?.groups?.length ?? 0) + (cur?.roles?.owners?.length ?? 0) > 0
      const nowEmpty = (cfg?.scope?.groups?.length ?? 0) === 0 && (cfg?.roles?.owners?.length ?? 0) === 0
      if (hadScope && nowEmpty) {
        throw new Error('拒绝写入：这会清空全部群白名单和 Owner。确认要清空请设 QQBOT_REFINE_FORCE=1')
      }
      // 防测试夹具覆写：原本是真实 openid，新配置一个都不认识、且全都不像 openid（G1/U1 这类）
      const openidLike = (s) => /^[0-9a-f]{16,64}$/i.test(String(s ?? '').trim())
      const prev = [...(cur?.scope?.groups ?? []), ...(cur?.scope?.dmUsers ?? []), ...(cur?.roles?.owners ?? [])]
      const next = [...(cfg?.scope?.groups ?? []), ...(cfg?.scope?.dmUsers ?? []), ...(cfg?.roles?.owners ?? [])]
      if (hadScope && next.length > 0 && !next.some((v) => prev.includes(v)) && !next.some(openidLike)) {
        throw new Error('拒绝写入：白名单 / Owner 全是疑似测试夹具（G1、U1 之类，不是 openid）。确认要写请设 QQBOT_REFINE_FORCE=1')
      }
    }
  } catch (err) {
    if (String(err?.message || '').includes('拒绝写入')) throw err
  }
  mkdirSync(STORE_DIR, { recursive: true })
  // 保存前先备份上一版（防手滑/测试覆盖）
  try {
    const backupDir = join(STORE_DIR, 'backups')
    mkdirSync(backupDir, { recursive: true })
    if (existsSync(CFG_PATH)) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      const dst = join(backupDir, `settings-${stamp}.json`)
      writeFileSync(dst, readFileSync(CFG_PATH, 'utf8'), 'utf8')
      const files = readdirSync(backupDir).filter((f) => f.startsWith('settings-')).sort()
      while (files.length > 20) {
        try { unlinkSync(join(backupDir, files.shift())) } catch { /* ignore */ }
      }
    }
  } catch { /* 备份失败不影响保存 */ }
  const tmp = `${CFG_PATH}.tmp-${process.pid}`
  writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf8')
  renameSync(tmp, CFG_PATH)
}
export function ensureStore() { mkdirSync(STORE_DIR, { recursive: true }) ; return STORE_DIR }
export { existsSync }








/** 自然接话挡位 → 概率倍率（1 很安静 … 5 很活跃） */
export function gearFactor(gear) {
  const g = Math.max(1, Math.min(5, Number(gear) || 3))
  const table = [0, 0.3, 0.6, 1, 1.6, 2.4]
  return table[g] ?? 1
}

/** 自然接话挡位 → 冷䩇倍率（越活跃冷却越短） */
export function gearCooldownFactor(gear) {
  const g = Math.max(1, Math.min(5, Number(gear) || 3))
  if (g >= 5) return 0.5
  if (g === 4) return 0.7
  if (g === 2) return 1.5
  if (g === 1) return 2.2
  return 1
}
