/**
 * 赞助/饭钱账本（跨群、跨私聊）：谁给过、多少、什么时候。
 * 只用于「被问起时照实说」和心里记着，不主动提、不邀功。
 */
import { join } from 'node:path'
import { readJson, writeJson, dirs, audit } from './store.js'

const PATH = join(dirs.root, 'sponsors.json')

function load() {
  const j = readJson(PATH, null)
  return j && Array.isArray(j.items) ? j : { items: [] }
}

export function addSponsor({ name, amount, note = '', by = '' } = {}) {
  const who = String(name || '').trim().slice(0, 20)
  const yuan = Number(amount)
  if (!who || !(yuan > 0)) return { ok: false, error: '需要名字和金额' }
  const db = load()
  const at = new Date().toISOString()
  db.items.push({ name: who, yuan: Number(yuan.toFixed(2)), note: String(note || '').slice(0, 40), by: String(by || '').slice(0, 20), at })
  db.items = db.items.slice(-100)
  writeJson(PATH, db)
  audit('sponsor.add', { name: who, yuan, by: String(by).slice(0, 12) })
  return { ok: true }
}

export function listSponsors(n = 10) {
  return load().items.slice(-n)
}

export function sponsorsText(n = 8) {
  const items = listSponsors(n)
  if (!items.length) return ''
  return items.map((x) => x.name + ' ¥' + Number(x.yuan).toFixed(0)).join('；')
}
