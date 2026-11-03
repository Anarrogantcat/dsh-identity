// 上传前隐私扫描：仓库里不许出现个人路径、用户名、真实密钥
//
// 用法：node scripts/privacy-scan.mjs [--strict]
//   默认只报告；--strict 时发现即退出码 1（发版前必须这么跑）
// 只读，不改文件。
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const strict = process.argv.includes('--strict')
const files = execSync('git ls-files', { encoding: 'utf8' }).trim().split('\n')
  .filter((f) => /\.(mjs|js|json|md|yml|yaml|html)$/.test(f))

const PATTERNS = [
  { name: '个人用户名', re: /Ranmi/g },
  { name: '个人 Windows 路径', re: /C:[\\/]+Users[\\/]+(?!<user>|<USER>)[A-Za-z0-9._$-]+/g },
  { name: '类 sk 密钥', re: /sk-[A-Za-z0-9_-]{24,}/g },
  { name: '疑似明文 token 赋值', re: /(?:token|secret|password|apikey|api_key)\s*[=:]\s*["'][A-Za-z0-9._-]{24,}["']/gi },
]

const hits = []
for (const f of files) {
  let s
  try { s = readFileSync(f, 'utf8') } catch { continue }
  const lines = s.split('\n')
  lines.forEach((line, i) => {
    // 测试里的假凭据用 TEST/FAKE/dummy 开头，是给脱敏逻辑做夹具的，不算泄漏
    if (/\b(TEST|FAKE|dummy|example)\b/i.test(line)) return
    for (const p of PATTERNS) {
      p.re.lastIndex = 0
      if (p.re.test(line)) hits.push({ file: f, line: i + 1, kind: p.name, text: line.trim().slice(0, 120) })
    }
  })
}

if (!hits.length) {
  console.log('隐私扫描通过：' + files.length + ' 个文件，没有个人路径/用户名/密钥。')
  process.exit(0)
}
console.log('发现 ' + hits.length + ' 处需要脱敏：')
for (const h of hits.slice(0, 50)) console.log('  ' + h.file + ':' + h.line + '  [' + h.kind + ']  ' + h.text)
if (hits.length > 50) console.log('  …还有 ' + (hits.length - 50) + ' 处')
console.log('')
console.log('改法：路径用 process.env.TEMP / dirs.root，文档用 <DSH_HOME>，密钥只留占位符。')
if (strict) process.exit(1)
