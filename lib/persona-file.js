/** 外部人格文件：文件优先，内联 baseText 只做兜底。 */
import { readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { CFG_PATH } from './config.js'

const MAX_FILE_BYTES = 512 * 1024
const cache = new Map()

export function resolvePersonaFilePath(value) {
  let raw = String(value ?? '').trim()
  if (!raw) return ''
  if (raw === '~') raw = homedir()
  else if (raw.startsWith('~/') || raw.startsWith('~\\')) raw = join(homedir(), raw.slice(2))
  return isAbsolute(raw) ? resolve(raw) : resolve(dirname(CFG_PATH), raw)
}

function normalizeText(value) {
  return String(value ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .trim()
}

/**
 * 读取当前人格文件。缓存同时记录 mtime + size，文件编辑后下一轮会重新读取。
 * 读取失败、空文件或超限时保留上一次成功内容，避免半写入瞬间清空人格。
 */
export function readPersonaFile(value) {
  const path = resolvePersonaFilePath(value)
  if (!path) return { path: '', text: '', state: 'unset' }

  let stat
  try {
    stat = statSync(path)
  } catch {
    const lastGood = cache.get(path)?.text ?? ''
    return { path, text: lastGood, state: lastGood ? 'last-good' : 'missing' }
  }

  const previous = cache.get(path)
  if (previous && previous.mtimeMs === stat.mtimeMs && previous.size === stat.size) {
    return { path, text: previous.text, state: previous.text ? 'cached' : 'empty' }
  }
  if (!stat.isFile() || stat.size > MAX_FILE_BYTES) {
    return { path, text: previous?.text ?? '', state: 'invalid' }
  }

  let text = ''
  try {
    text = normalizeText(readFileSync(path, 'utf8'))
  } catch {
    return { path, text: previous?.text ?? '', state: previous?.text ? 'last-good' : 'unreadable' }
  }

  const kept = text || previous?.text || ''
  cache.set(path, { mtimeMs: stat.mtimeMs, size: stat.size, text: kept })
  return { path, text: kept, state: text ? 'loaded' : (kept ? 'last-good' : 'empty') }
}

