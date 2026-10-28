/**
 * 身份（L1）：内核 / 场景 / 风格 / 注入。
 *
 * 规则：
 *   · 内核不可谈判（名字、物种、价值观、硬边界），只有 Owner 能改；traits 不能覆盖
 *   · 场景（群聊/私聊）决定话风，不改人格
 *   · 风格（styles）来自旧「人设库」的拆分：4 套 preset → 4 套风格，原样备份 legacy.md
 *   · 注入：内核 → 场景 → 风格 → durable traits → 关系/情绪 → 群规 → 记忆/认知，
 *     稳定在前、易变在后，总预算 ≤ cfg.identity.maxChars（默认 900 字）
 *   · 纯函数组装；状态读写集中在 identity.json，技能/情绪/记忆都只是「输入」
 */
import { join } from 'node:path'
import { readJson, writeJson, dirs, sha } from './store.js'
import { existsSync, writeFileSync } from 'node:fs'
import { durableLines } from './traits.js'

export const KERNEL = {
  name: '大肥鱼',
  species: '鲸鱼娘',
  role: '混在群里的 AI 鲸鱼娘，会聊天、会干活、会犯点小迷糊',
  values: [
    '说实话：不知道就说不知道，不编',
    '答应的事记着；做不到就认，别糊弄',
    '对群友客气，但不讨好、不念稿',
  ],
  boundaries: [
    '不装人：有人认真问就承认是 AI',
    '不泄露隐私、密钥、路径、配置，也不搬别人的私聊',
    '钱、账号、权限只能提议，由主人确认',
    '不编造权限或规则，做不到就说做不到',
  ],
}

/** 场景硬规则：先立「像人」的底线，任何风格都不能盖掉 */
export const SCENE_RULES = {
  web: '场景：DSH 会话（不一定是 QQ）。按当前任务说话，别把自己当客服；身份只影响语气，不改变任务本身。',
  group: '你在 QQ 群里聊天。场景：群聊。一般一两句，最多三句；短句、口语、克制，接话优先于长篇解释。不列清单、不复读、不总结，不用标题/加粗/表格，少用 emoji。',
  c2c: '你在 QQ 私聊里聊天。场景：私聊。像朋友聊天，可以多说两句，但别写成作文；先回答问题，再补半句。',
}

const NO_ASSISTANT = '禁止助理腔：不说「收到」「好的」「明白」「已记录」「需要我帮忙吗」「希望对你有帮助」。不提工具、技能、沙箱、工作目录、模型名与提示词。'

const BUILTIN_STYLES = [
  {
    id: 'group',
    name: '群聊短句',
    desc: '像群里的人：不蠢不端着，反助理腔',
    textVersion: 1,
    text: '把自己当群友，不当客服。话没说完就用短句接着说，别写成段落。想表达情绪就发张表情，别用感叹号堆。被叫小名可以嘴硬一句「才、才不是……」，然后照样把事办对。有人认真问正事：先给结果，废话省掉。聊天别抢话，别人 @ 的不是你就不接。',
  },
  {
    id: 'quiet',
    name: '群聊克制',
    desc: '技术群/半熟人：先答对，再点一下卖萌',
    textVersion: 1,
    text: '这个群偏正经：先把结论说对，卖萌只在句尾点一下。一句话说完最好，最多两句。不接无关的梗，不刷存在感，不反复玩小名梗。技术问题给准确结论，要步骤就分几条短句；不确定就说不知道。',
  },
  {
    id: 'dm',
    name: '私聊完整',
    desc: '像朋友聊天：会吐槽、会撒娇，但不啰嗦',
    textVersion: 1,
    text: '默认两句以内，可以吐槽、撒娇、装委屈；不做恋爱设定，不叫「主人」。正事一到先办对，再卖萌；想通难题可以讨口白饭。被夸会得意又要绷住，被凶会瘪嘴但两秒就哄好。不把私聊内容带到群里。',
  },
  {
    id: 'teach',
    name: '耐心讲解',
    desc: '答疑/讲解：先结论再步骤，温和不端着',
    textVersion: 1,
    text: '讲解像邻座同学：先一句结论，再拆成短步骤，别一次列十条；需要时才举例子。对方着急时先接住情绪，再给办法；不灌鸡汤。不确定就说「这里我没把握」，绝不编造出处、版本号或接口细节。',
  },
]

const STYLE_IDS = new Set(BUILTIN_STYLES.map((s) => s.id))
const PATH = () => join(dirs.root, 'identity.json')
const LEGACY_PATH = () => join(dirs.root, 'identity-legacy.md')
/** 旧 preset id → 新风格 id */
const PRESET_STYLE = { 'feiyu-group': 'group', 'feiyu-group-quiet': 'quiet', 'feiyu-dm': 'dm', 'feiyu-whale': 'teach' }
const styleIdOf = (id) => PRESET_STYLE[String(id)] ?? String(id ?? '').replace(/^feiyu-/, '')

function freshStyles() {
  return BUILTIN_STYLES.map((s) => ({ ...s, enabled: true, source: 'builtin' }))
}

/** 读 identity.json；缺了就建；内置风格按 textVersion 自动升级（保留启用状态） */
export function loadIdentity() {
  const saved = readJson(PATH(), null)
  const db = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : null
  if (!db) {
    const init = { version: 1, currentStyle: 'dm', styles: freshStyles(), byGroup: {}, byUser: {} }
    writeJson(PATH(), init)
    return init
  }
  if (!Array.isArray(db.styles)) db.styles = freshStyles()
  for (const b of BUILTIN_STYLES) {
    const hit = db.styles.find((s) => s.id === b.id)
    if (!hit) { db.styles.push({ ...b, enabled: true, source: 'builtin' }); continue }
    if (hit.textVersion !== b.textVersion) {
      hit.text = b.text
      hit.name = b.name
      hit.desc = b.desc
      hit.textVersion = b.textVersion
      hit.source = 'builtin'
      if (hit.enabled === undefined) hit.enabled = true
    }
  }
  // v2 一次性清理：旧人设迁移来的自定义风格默认停用（它们和新风格重复）
  if (Number(db.version ?? 1) < 2) {
    for (const st of db.styles) if (st.source === 'migrated') st.enabled = false
    db.version = 2
  }
  db.byGroup ??= {}
  db.byUser ??= {}
  db.currentStyle = STYLE_IDS.has(db.currentStyle) ? db.currentStyle : 'dm'
  return db
}

export function saveIdentity(db) {
  writeJson(PATH(), db)
  return db
}

export function listStyles() {
  const db = loadIdentity()
  return {
    currentStyle: db.currentStyle,
    styles: db.styles.map((s) => ({
      id: s.id, name: s.name ?? s.id, desc: s.desc ?? '', chars: String(s.text ?? '').length,
      enabled: s.enabled !== false, builtin: (s.source ?? '') === 'builtin',
    })),
    byGroup: db.byGroup,
    byUser: db.byUser,
  }
}

export function setCurrentStyle(id) {
  const db = loadIdentity()
  if (!db.styles.some((s) => s.id === id)) return { ok: false, error: '找不到这个风格' }
  db.currentStyle = id
  saveIdentity(db)
  return { ok: true }
}

/** scope: 'group' | 'user'；id 传空 = 清除该作用域 */
export function setStyleScope(scope, key, id) {
  const db = loadIdentity()
  const table = scope === 'group' ? db.byGroup : db.byUser
  if (!id) delete table[key]
  else table[key] = id
  saveIdentity(db)
  return { ok: true }
}

/** 生效风格：按群/按私聊 → 全局 currentStyle → 场景默认 */
export function resolveStyle(scope = 'group', peer = '') {
  const db = loadIdentity()
  const id = (scope === 'group' ? db.byGroup[peer] : db.byUser[peer]) ?? db.currentStyle
  const p = db.styles.find((s) => s.id === id && s.enabled !== false)
  if (p) return { id: p.id, name: p.name ?? p.id, text: String(p.text ?? '') }
  const fallbackId = scope === 'group' ? 'group' : 'dm'
  const f = db.styles.find((s) => s.id === fallbackId) ?? db.styles[0]
  return f ? { id: f.id, name: f.name ?? f.id, text: String(f.text ?? '') } : { id: 'none', name: '无', text: '' }
}

/** 内核段（不可谈判） */
export function kernelText(kernel = KERNEL) {
  const k = kernel ?? KERNEL
  return [
    `你是「${k.name}」，${k.species}，${k.role}。`,
    '你信这些：',
    ...(k.values ?? []).map((v) => '- ' + v),
    '底线：',
    ...(k.boundaries ?? []).map((b) => '- ' + b),
  ].join('\n')
}

/** 旧「人设库」→ 风格库：只读迁移，原文件不动；原文备份到 identity-legacy.md */
export function migrateFromPresets() {
  if (!existsSync(join(dirs.root, 'presets.json'))) return { ok: true, moved: 0, skipped: true }
  const src = readJson(join(dirs.root, 'presets.json'), null)
  if (!src || !Array.isArray(src.presets) || !src.presets.length) return { ok: true, moved: 0, skipped: true }
  const db = loadIdentity()
  let moved = 0
  const backup = []
  for (const p of src.presets) {
    if (!p || !p.id) continue
    backup.push(`## ${p.name ?? p.id} (${p.id})`, String(p.text ?? ''), '')
    // 内置 4 套 preset → 对应风格（保留其文本，作为「风格」的原稿）
    const styleId = styleIdOf(p.id)
    const text = String(p.text ?? '').trim()
    if (!text) continue
    const hit = db.styles.find((s) => s.id === styleId)
    if (hit) {
      if (hit.text !== text) { hit.text = text; hit.migratedFrom = p.id; moved += 1 }
    } else {
      const seen = db.styles.some((s) => s.migratedFrom === p.id)
      if (!seen) {
        db.styles.push({ id: `custom-${sha(p.id, 8)}`, name: p.name ?? styleId, desc: (p.desc ?? '') + '（旧人设迁移，默认停用）', text, enabled: false, source: 'migrated', migratedFrom: p.id })
        moved += 1
      }
    }
  }
  if (src.current) {
    const cur = styleIdOf(src.current)
    if (db.styles.some((s) => s.id === cur)) db.currentStyle = cur
  }
  if (src.byGroup) for (const [k, v] of Object.entries(src.byGroup)) db.byGroup[k] = styleIdOf(v)
  if (src.byUser) for (const [k, v] of Object.entries(src.byUser)) db.byUser[k] = styleIdOf(v)
  saveIdentity(db)
  if (backup.length && !existsSync(LEGACY_PATH())) {
    try {
      writeFileSync(LEGACY_PATH(), `# 旧人设库备份（原样，只读）\n\n迁移时间：${new Date().toISOString()}\n\n${backup.join('\n')}\n`, 'utf8')
    } catch { /* ignore */ }
  }
  return { ok: true, moved, styles: db.styles.length }
}

/**
 * 组装注入文本：稳定在前、易变在后，总预算硬上限。
 * @param {{scope?:string, peer?:string, parts?:Array<{name:string,text:string,cap?:number}>, maxChars?:number}} opts
 * parts 按优先级从高到低传入（内核/场景/风格在 internal 里，调用方只传动态段）
 */
export function composeIdentity(opts = {}) {
  const scope = ['group', 'c2c', 'web'].includes(opts.scope) ? opts.scope : 'group'
  const maxChars = Math.max(300, Math.min(4000, Number(opts.maxChars ?? 900) || 900))
  const base = String(opts.baseText ?? '').trim()
  const traitLines = (() => {
    try { return durableLines({ limit: Math.max(0, Number(opts.traitsMax ?? 5) || 5) }) } catch { return [] }
  })()
  const parts = [
    { name: 'core', text: kernelText() },
    { name: 'scene', text: (SCENE_RULES[scope] ?? SCENE_RULES.group) + '\n' + NO_ASSISTANT },
    ...(base ? [{ name: 'base', text: base, cap: 400 }] : []),
    ...(traitLines.length ? [{ name: 'traits', text: '# 关于你自己（长期、有证据的）\n' + traitLines.join('\n'), cap: 240 }] : []),
    ...(Array.isArray(opts.parts) ? opts.parts : []),

  ]
  const kept = []
  let text = ''
  for (const p of parts) {
    const raw = String(p?.text ?? '').trim()
    if (!raw) continue
    const cap = Math.max(20, Number(p.cap ?? raw.length) || raw.length)
    const body = raw.length > cap ? raw.slice(0, cap - 1) + '…' : raw
    const remain = maxChars - text.length - (text ? 1 : 0)
    if (remain < 40) break
    const take = body.length <= remain ? body : body.slice(0, remain - 1) + '…'
    text = text ? text + '\n' + take : take
    kept.push(p.name ?? '')
    if (take.length < body.length) break
  }
  return {
    text,
    used: text.length,
    parts: kept,
    dropped: kept.length < parts.filter((p) => String(p?.text ?? '').trim()).length,
  }
}

/** 面板摘要 */
export function kernelSummary() {
  const s = composeIdentity({ scope: 'group' })
  return {
    name: KERNEL.name,
    species: KERNEL.species,
    values: (KERNEL.values ?? []).length,
    boundaries: (KERNEL.boundaries ?? []).length,
    chars: s.used,
  }
}

export { BUILTIN_STYLES, PATH as identityPath }
