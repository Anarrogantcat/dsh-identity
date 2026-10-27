/**
 * 命令卡片：把 #帮助 / #群状态 这类文本输出画成 PNG 图（0 token，不走模型）
 * 依赖 profile 里已有的 sharp（找不到就返回 null，由调用方回落纯文本）
 */
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
import { dirs } from './store.js'

let sharpMod = null
/** 依次尝试：插件自身、profile 的 node_modules、cwd；找不到返回 null（调用方回落文本） */
export async function getSharp() {
  if (sharpMod) return sharpMod
  const { existsSync, readdirSync } = await import('node:fs')
  const home = process.env.DSH_HOME || join(process.env.USERPROFILE || process.env.HOME || '', '.dsh')
  const cands = [new URL('../package.json', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')]
  try {
    const prof = join(home, 'profiles')
    for (const p of readdirSync(prof)) cands.push(join(prof, p, 'node_modules', 'x.js'))
  } catch { /* ignore */ }
  cands.push(join(process.cwd(), 'node_modules', 'x.js'))
  for (const base of cands) {
    try {
      const req = createRequire(base.startsWith('/') || /^[A-Za-z]:/.test(base) ? base : base)
      const p = req.resolve('sharp')
      const mod = await import(new URL(`file://${p.replace(/\\/g, '/')}`).href)
      sharpMod = mod.default ?? mod
      if (sharpMod) return sharpMod
    } catch { /* 下一个 */ }
  }
  try {
    const mod = await import('sharp')
    sharpMod = mod.default ?? mod
    return sharpMod
  } catch { return null }
}
const FONT = 'Microsoft YaHei, Segoe UI, sans-serif'
const W = 860

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * @param {{title:string, subtitle?:string, sections:{icon?:string,title:string,rows:{cmd:string,note?:string}[]}[], footer?:string}} data
 */
export function buildSvg(data) {
  const pad = 34
  const rowGap = 28
  let y = pad + 44
  const parts = []

  parts.push(`<text x="${pad}" y="${y}" font-family="${FONT}" font-size="27" font-weight="600" fill="#e6ecf7">${esc(data.title)}</text>`)
  if (data.subtitle) {
    y += 28
    parts.push(`<text x="${pad}" y="${y}" font-family="${FONT}" font-size="15" fill="#93a1bb">${esc(data.subtitle)}</text>`)
  }
  y += 34

  for (const s of data.sections) {
    parts.push(`<text x="${pad}" y="${y}" font-family="${FONT}" font-size="17" font-weight="600" fill="#cfe0ff">${esc((s.icon ? s.icon + ' ' : '') + s.title)}</text>`)
    y += 12
    parts.push(`<line x1="${pad}" y1="${y}" x2="${W - pad}" y2="${y}" stroke="#26314a" stroke-width="1"/>`)
    y += 22
    for (const r of s.rows) {
      parts.push(`<text x="${pad + 2}" y="${y}" font-family="${FONT}" font-size="16" fill="#8fb4ff">${esc(r.cmd)}</text>`)
      if (r.note) parts.push(`<text x="${pad + 320}" y="${y}" font-family="${FONT}" font-size="15" fill="#93a1bb">${esc(r.note)}</text>`)
      y += rowGap
    }
    y += 14
  }

  let footer = ''
  if (data.footer) {
    y += 6
    parts.push(`<line x1="${pad}" y1="${y - 20}" x2="${W - pad}" y2="${y - 20}" stroke="#26314a" stroke-width="1"/>`)
    parts.push(`<text x="${pad}" y="${y}" font-family="${FONT}" font-size="14" fill="#37c98b">${esc(data.footer)}</text>`)
    y += 6
  }

  const h = Math.round(y + pad - 6)
  const head = `<rect x="0" y="0" width="${W}" height="${h}" rx="18" fill="#151c2b"/><rect x="0" y="0" width="${W}" height="5" rx="2" fill="#4d8dff"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${h}">${head}${parts.join('')}</svg>`
}
export async function renderPng(data) {
  const sharp = await getSharp()
  if (!sharp) return null
  try {
    const svg = buildSvg(data)
    const buf = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer()
    return buf
  } catch {
    return null
  }
}

/** 画一张图并落盘，返回本地路径（失败返回 null） */
export async function renderToFile(data, name = 'card') {
  const buf = await renderPng(data)
  if (!buf) return null
  try {
    const p = join(dirs.tmp, `${name}-${Date.now()}.png`)
    writeFileSync(p, buf)
    return p
  } catch {
    return null
  }
}

export function helpCardData() {
  return {
    title: '🐟 QQ 机器人 · 命令卡',
    subtitle: '全部命令都在模型之前处理：不消耗 token，也不写入聊天上下文',
    sections: [
      {
        icon: '🪪',
        title: '认领与状态',
        rows: [
          { cmd: '#绑定 <8 位码>', note: '面板生成，一次性；绑定 Owner/本群/私聊' },
          { cmd: '#绑定本群', note: '群主/管理员可直接把本群加入白名单' },
          { cmd: '#群状态', note: '闭麦剩余、免打扰、群管识别情况' },
          { cmd: '#群列表 · #群成员', note: '看她在的群 / 本群成员与群名片（仅 onebot）' },
        ],
      },
      {
        icon: '🔇',
        title: '群秩序（Owner / Admin）',
        rows: [
          { cmd: '#闭嘴 30m', note: '让我完全闭嘴（Owner 仍可 @ 我）' },
          { cmd: '#余额 / #饭：看看今天还剩多少饭（余额）\n#充值 5：给大肥鱼添饭钱（有上限）\n#充值码：要收款码（面板开关控制）\n#说话', note: '解除闭麦' },
          { cmd: '#撤回 <msgId>', note: '撤回消息（需我在群里是管理员）' },
          { cmd: '#禁言 <openid> 10m', note: '只能禁普通成员' },
          { cmd: '#解禁 <openid>', note: '解除禁言' },
          { cmd: '#踢人 <QQ> [不再同意]', note: '踢人（仅 onebot，需管理员）' },
          { cmd: '#名片 <QQ> 新名片', note: '改群名片（仅 onebot）' },
        ],
      },
      {
        icon: '🆘',
        title: '救援（Owner）',
        rows: [
          { cmd: '#内存', note: '看空闲内存 + vmmemWSL + 前 6 个吃内存的进程' },
          { cmd: '#清理', note: '按名单杀进程（默认 discord/steam/百度网盘/SillyTavern）' },
          { cmd: '#杀进程 <名字>', note: '精确杀一个（保命进程会被拒绝）' },
          { cmd: '#重启WSL', note: '立刻释放 WSL 占的内存（语音服务会停）' },
          { cmd: '#重启电脑 确认', note: '10 秒后重启；#取消重启 可撤销' },
        ],
      },
      {
        icon: '🧠',
        title: '记忆与人设',
        rows: [
          { cmd: '#记得 内容', note: '写入长期记忆（会淡忘，被提及会加强）' },
          { cmd: '#忘掉 关键词', note: '删除匹配的记忆' },
          { cmd: '#记忆', note: '看最近的记忆条目' },
          { cmd: '#人设 列表 / #人设 切换 <名字>', note: '切换人设（面板里可建库）' },
        ],
      },
      {
        icon: '🎨',
        title: '表情包',
        rows: [
          { cmd: '#表情 无语', note: '从图库挑一张发（情绪：开心/无语/生气…）' },
          { cmd: '#同步图库', note: '同步远程图库索引' },
        ],
      },
      {
        icon: '📺',
        title: 'B站',
        rows: [
          { cmd: '#B站 <链接>', note: '解析视频信息与可选画质' },
          { cmd: '#B站订阅 <mid>', note: '订阅 UP 动态推送' },
          { cmd: '#B站订阅列表', note: '看当前订阅' },
          { cmd: '#B站推送 开/关', note: '仅 Owner' },
        ],
      },
      {
        icon: 'ℹ️',
        title: '其它',
        rows: [
          { cmd: '#帮助', note: '这张卡' },
          { cmd: '#赞', note: '给这条消息贴个表情（仅 onebot）' },
          { cmd: '#换头像 <图片地址>', note: '换她自己的头像（引用一张图再发也行；仅 Owner）' },
          { cmd: '#用量', note: '闸门计数与钩子状态' },
        ],
      },
    ],
    footer: '管理类命令仅 Owner / Admin 可用 · 斜杠命令（/model 等）仅 Owner · 全部 0 token',
  }
}

