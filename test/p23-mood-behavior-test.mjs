/**
 * P23 心情→行为：不是只改语气，行为也要变；但事实/边界不因心情变
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-p23-'))
delete process.env.QQBOT_REFINE_HOME
const url = (p) => new URL(p, import.meta.url).href
const M = await import(url('../lib/moodv2.js'))
const ok = []
const T = (n, p, d) => ok.push([n, !!p, d])
const base = { seven: { joy: 0.3, anger: 0.3, sorrow: 0.3, fear: 0.3, love: 0.3, disgust: 0.3, desire: 0.3 }, needs: { belly: 0.3, safety: 0.3, belonging: 0.3, respect: 0.3, curiosity: 0.3, intimacy: 0.3 } }
const mk = (seven, needs = {}) => ({ seven: { ...base.seven, ...seven }, needs: { ...base.needs, ...needs } })

T('平稳时行为不变', (() => { const b = M.behaviorFactor(base); return b.proactive === 1 && b.reply === 1 })())
const resist = M.behaviorFactor(mk({ disgust: 0.8 }))
T('抗拒 → 少主动、少接', resist.proactive < 0.6 && resist.reply < 0.8, resist)
const smug = M.behaviorFactor(mk({ joy: 0.8 }, { respect: 0.8 }))
T('得意 → 更主动', smug.proactive > 1.2 && smug.sticker > 1.1, smug)
const wronged = M.behaviorFactor(mk({ sorrow: 0.8 }, { belonging: 0.1 }))
T('委屈 → 安静', wronged.proactive < 0.7, wronged)
T('表情情绪跟着复合走', M.stickerMoodHint(mk({ disgust: 0.8 })) === '无语' && M.stickerMoodHint(mk({ joy: 0.8 }, { respect: 0.8 })) === '开心')
T('行为因子有上下限', Object.values(M.behaviorFactor(mk({ joy: 1, anger: 1, disgust: 1 }))).filter((x) => typeof x === 'number').every((x) => x >= 0.2 && x <= 1.8))
T('不开心 → 不想搭腔（内容倾向）', M.stanceLines(mk({ disgust: 0.8 })).some((x) => x.includes('不想搭腔')))
T('得意 → 愿意多说（内容倾向）', M.stanceLines(mk({ joy: 0.8 }, { respect: 0.8 })).some((x) => x.includes('得瑟')))
T('饿了 → 会提吃的', M.stanceLines(mk({}, { belly: 0.9 })).some((x) => x.includes('白饭')))
const sb = M.stanceBlock(mk({ disgust: 0.8 }))
T('状态块标注事实不变', sb.includes('事实与边界不变'), sb)
T('状态块不超字数', sb.length <= 160)
console.log('=== P23 心情行为测试 ===')
let fail = 0
for (const [n, p, d] of ok) { console.log((p ? 'OK  ' : 'FAIL ') + n + (p ? '' : '   ' + JSON.stringify(d))); if (!p) fail++ }
console.log(fail ? '失败 ' + fail : '全部通过')
try { rmSync(process.env.DSH_HOME, { recursive: true, force: true }) } catch {}
process.exit(fail ? 1 : 0)
