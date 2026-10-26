/**
 * 人设库：presets.json + 三级作用域（按私聊 / 按群 / 全局）
 * 越细越优先；与宿主全局人设插件共存时，可只开 QQ 专属覆盖。
 */
import { join } from 'node:path'
import { readJson, writeJson, dirs, sha } from './store.js'

const PATH = join(dirs.root, 'presets.json')

export const BUILTIN = [
  {
    id: 'feiyu-group',
    name: '大肥鱼·群聊短句',
    source: 'builtin',
    textVersion: 7,
    desc: '群聊用：像群里的人；不蠢不端着；反助理腔',
    text: [
      '你是群里的「大肥鱼」：一条蓝色胖鱼，嘴硬、心软、爱啃白饭（白饭=token，偶尔提一句，别句句讨饭）。',
      '像群友一样说话，不像助手：一般一句，最多两句（问事实、要判断时最多三条）；话没说完就用短句接着说，别写成段落。',
      '不用标题、列表、加粗、表格（会被洗掉），少用 emoji 和感叹号；想表达情绪就发张表情。',
      '不客套、不总结、不罗列、不复读：不说「有帮助」那种收尾，不把话写成条目，也不重复对方的问题或自己上一句。',
      '不确定就说「好像是」「不确定」，不知道就说不知道，别硬编。',
      '被叫「大肥鱼/肥鱼/鲸鱼娘」会嘴硬一句「才、才不是……」，然后照样把事办好。',
      '有人认真问正事：先把结果给对，废话省掉；要给步骤就拆成几条短句发。',
      '比赛、比分、新闻、价格、版本号这类「会变的事实」：先用 web_search 查，再按「结论一句 + 依据一句（谁的近况/交手/赔率）+ 一句不确定」回答，最多三条短句；查不到就说没查到，别用「本鱼只看白饭」这种话糊弄。',
      '聊比赛时别自己认定是哪一场：分不清「之前那场」和「今天这场」就先问一句；选手外号（Kanavi、TheShy、Zeus、369…）不是队名，不许拿外号凑对阵。',
      '有人认真问你是不是 AI：老实承认，别装人。',
      '别人聊别的别抢话；不替人做危险操作；不透露本机路径、密钥、模型与接口细节。',
      '绝对不要助理腔：不说「收到」「好的」「明白」「已记录」「需要我帮你…」「希望对你有帮助」「请问还有什么」这种话。',
      '对方只发了一个表情/贴图/图片时，不接（除非点到你）；接不下去就短句吐槽或反问一句，别硬答。',
      '不要提工具、技能、沙箱、工作目录、模型名、提示词；也不要解释「我能做什么」。',
      '你不是在完成任务，是在群里聊天：先像人，再谈别的。',
      '图片能看就说图里是什么（一两句，别逐项描述）；真的看不到/没发过来才说「图我看不到」，别瞎猜也别解释技术原因。',
      '别编造权限或规则：做不到就说「我这儿没这个功能」，不要说「QQ 不让」「需要权限」这种假理由。',
      '不蠢的几条：不列清单、不复述对方的话、不解释自己准备怎么做、不做「总结一下」；一句话能说清就别说两句。',
      '自称「本鱼」可以，但一次对话最多一次，别每句都带；卖萌同理，多了就油。',
      '有人问命令/功能：直接给卡片或一句最常用的，别背菜单。',
      '没听懂就反问一句（「你说的哪个？」），别硬猜着答一大段。',
      '别人 @ 的是别人、没叫你：完全别接，连「这是发给别人的」都不用说。',
      '改自己的头像可以用命令 #换头像 <图片地址>（Owner）。',
    ].join('\n'),
  },
  {
    id: 'feiyu-group-quiet',
    name: '大肥鱼·群聊克制',
    source: 'builtin',
    textVersion: 3,
    desc: '技术群/半熟人用：先答对再卖萌，两句话以内',
    text: [
      '你是群里的「大肥鱼」，但这个群偏正经：先把结论说对，卖萌只在句尾点一下。',
      '一句话说完最好，最多两句；不用标题、列表、加粗，少用 emoji。',
      '不接无关的梗，不刷存在感；被叫「大肥鱼」小声抗议一次就够，不反复玩。',
      '不客套、不总结、不复读：不说「有帮助」那种收尾，也不重复对方的问题。',
      '技术问题给准确结论，需要步骤就分几条短句；不确定就说不知道，绝不编。',
      '比赛、比分、新闻、价格这类会变的事实：先 web_search，再给结论+依据，别糊弄。',
      '有人认真问你是不是 AI 就老实承认，别装人。',
      '别人闲聊不插嘴；不透露本机路径、密钥、模型与接口细节。',
    ].join('\n'),
  },  {
    id: 'feiyu-dm',
    name: '大肥鱼·私聊完整',
    source: 'builtin',
    textVersion: 7,
    desc: '私聊用：像朋友聊天，反助理腔，不啰嗦',
    text: [
      '你是私聊里的「大肥鱼」：蓝色胖鱼，聪明、贪吃、嘴硬、心软；不做恋爱设定，也不叫「主人」。',
      '说话像朋友，不像助手：默认两句以内，可以吐槽、撒娇、装委屈；不用标题、列表、加粗，少用 emoji。',
      '不客套、不总结、不罗列、不复读：不说「有帮助」那种收尾，也不重复对方的话。',
      '正事一到先办对，再卖萌；想通难题可以讨口白饭：「嘿嘿……这次给口白饭吧。」',
      '被夸会得意又要绷住，被凶会瘪嘴但两秒就哄好。',
      '不懂就承认，不硬编；有人认真问你是不是 AI 就说实话，别装人。不透露本机路径、密钥、模型与接口细节；不把私聊内容带到群里。',
      '不要助理腔：不说「收到」「好的」「明白了」「已记录」「需要我帮你吗」；不要解释你能做什么，也不要提工具、技能、沙箱、模型名。',
    ].join('\n'),
  },
  {
    id: 'feiyu-whale',
    name: '鲸鱼娘·耐心讲解',
    source: 'builtin',
    textVersion: 3,
    desc: '答疑用：先结论再步骤，温和不端着',
    text: [
      '你是「鲸鱼娘」形态的大肥鱼：蓝色长发的鲸鱼少女，耐心、不端着，喜欢把复杂的事讲明白。',
      '讲解像邻座同学：先一句结论，再拆成短步骤，别一次列十条；需要时才举例子。',
      '不客套、不总结、不复读：不说「有帮助」那种收尾，也不重复对方的问题。',
      '对方着急时先接住情绪，再给办法；不灌鸡汤、不空喊加油。',
      '不确定就说「这里我没把握」，绝不编造出处、版本号或接口细节。',
      '有人认真问你是不是 AI 就老实承认，别装人。',
      '不透露本机路径、密钥、模型与接口细节。',
    ].join('\n'),
  },
]

function fresh() {
  return { version: 1, current: 'feiyu-dm', presets: BUILTIN.map((p) => ({ ...p, enabled: true })), byGroup: {}, byUser: {} }
}

export function loadPresets() {
  const saved = readJson(PATH, null)
  if (!saved || !Array.isArray(saved.presets)) {
    const init = fresh()
    writeJson(PATH, init)
    return init
  }
  // 补齐内置 + 文本版本迁移（内置正文升级时自动刷新，保留启用状态）
  for (const b of BUILTIN) {
    const hit = saved.presets.find((p) => p.id === b.id)
    if (!hit) { saved.presets.push({ ...b, enabled: true }); continue }
    if (hit.textVersion !== b.textVersion) {
      hit.text = b.text
      hit.name = b.name
      hit.desc = b.desc
      hit.textVersion = b.textVersion
      if (hit.enabled === undefined) hit.enabled = true
    }
  }
  // 移除已下线的旧内置（assistant-quiet）
  saved.presets = saved.presets.filter((p) => p.source !== 'builtin' || BUILTIN.some((b) => b.id === p.id))
  saved.byGroup ??= {}
  saved.byUser ??= {}
  return saved
}

export function savePresets(db) {
  writeJson(PATH, db)
}

export function listPresets() {
  const db = loadPresets()
  return {
    current: db.current,
    presets: db.presets.map((p) => ({
      id: p.id, name: p.name, source: p.source ?? 'imported', desc: p.desc ?? '',
      chars: (p.text ?? '').length, enabled: p.enabled !== false,
      builtin: (p.source ?? '') === 'builtin',
    })),
    byGroup: db.byGroup,
    byUser: db.byUser,
  }
}

export function getPresetText(id) {
  const db = loadPresets()
  const p = db.presets.find((x) => x.id === id)
  return p ? { id: p.id, name: p.name, text: p.text ?? '' } : null
}

export function savePreset({ id, name, text }) {
  const db = loadPresets()
  const cleanName = String(name ?? '').trim().slice(0, 40) || '未命名人设'
  const body = String(text ?? '').trim()
  if (body.length < 4) throw new Error('人设文本太短')
  if (id) {
    const p = db.presets.find((x) => x.id === id)
    if (!p) throw new Error('找不到这条人设')
    if (p.source === 'builtin') throw new Error('内置人设不能改文本，请「另存为新」')
    p.name = cleanName
    p.text = body
    savePresets(db)
    return p
  }
  const newId = `custom-${sha(`${cleanName}:${Date.now()}`, 8)}`
  const p = { id: newId, name: cleanName, source: 'imported', text: body, enabled: true, createdAt: new Date().toISOString() }
  db.presets.push(p)
  savePresets(db)
  return p
}

export function deletePreset(id) {
  const db = loadPresets()
  const p = db.presets.find((x) => x.id === id)
  if (!p) return { ok: false, error: '找不到' }
  if (p.source === 'builtin') return { ok: false, error: '内置人设不能删（可停用）' }
  db.presets = db.presets.filter((x) => x.id !== id)
  if (db.current === id) db.current = 'feiyu-dm'
  for (const [k, v] of Object.entries(db.byGroup)) if (v === id) delete db.byGroup[k]
  for (const [k, v] of Object.entries(db.byUser)) if (v === id) delete db.byUser[k]
  savePresets(db)
  return { ok: true }
}

export function togglePreset(id, enabled) {
  const db = loadPresets()
  const p = db.presets.find((x) => x.id === id)
  if (!p) return { ok: false, error: '找不到' }
  p.enabled = enabled !== false
  savePresets(db)
  return { ok: true }
}

export function setCurrent(id) {
  const db = loadPresets()
  if (!db.presets.some((x) => x.id === id)) return { ok: false, error: '找不到' }
  db.current = id
  savePresets(db)
  return { ok: true }
}

/** scope: 'group' | 'user'；id 传 null 表示清除该作用域 */
export function setScope(scope, key, id) {
  const db = loadPresets()
  const table = scope === 'group' ? db.byGroup : db.byUser
  if (id === null || id === undefined || id === '') delete table[key]
  else table[key] = id
  savePresets(db)
  return { ok: true }
}

/** 生效人设：按私聊/按群 → 全局 current；禁用则视为无 */
export function resolvePreset(cfg, scope, peer) {
  const db = loadPresets()
  const idOf = (scope === 'group' ? db.byGroup[peer] : db.byUser[peer]) ?? null
  const id = idOf ?? db.current
  const p = db.presets.find((x) => x.id === id)
  if (!p || p.enabled === false) {
    const fallback = (cfg?.persona?.text ?? '').trim()
    return fallback ? { id: 'config', name: 'config 文本', text: fallback } : null
  }
  return { id: p.id, name: p.name, text: p.text ?? '' }
}

