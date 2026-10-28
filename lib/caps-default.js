/** 默认能力注册（L4）：插件启动即注册；多入口共用同一套策略/审计 */
import { registerCapability } from './caprun.js'
import { generate as drawImage, searchSnippets } from './draw.js'
import { speakToFile } from './voice.js'
import { query as xhhQuery } from './xiaoheihe.js'

registerCapability({
  id: 'image.generate',
  provider: 'comfyui',
  policyKey: 'image.generate',
  cost: 0,
  timeoutMs: 300000,
  run: async ({ cfg, params = {}, logger }) => {
    const r = await drawImage(cfg, params.prompt, params.ref ? { ref: params.ref } : {}, logger)
    return r.ok ? { ok: true, data: r } : { ok: false, code: 'draw_failed', error: r.error }
  },
})

registerCapability({
  id: 'voice.speak',
  provider: 'tts',
  policyKey: 'voice.speak',
  cost: 0,
  timeoutMs: 90000,
  run: async ({ params = {} }) => {
    const r = await speakToFile(params.vc, params.text)
    return r.ok ? { ok: true, data: r } : { ok: false, code: 'tts_failed', error: r.error }
  },
})

registerCapability({
  id: 'link.search',
  provider: 'web',
  policyKey: 'link.search',
  cost: 0,
  timeoutMs: 20000,
  run: async ({ params = {} }) => {
    const r = await searchSnippets(params.query, params.limit ?? 2)
    return { ok: true, data: r }
  },
})

registerCapability({
  id: 'xiaoheihe.query',
  provider: 'cli',
  policyKey: 'tool.read',
  cost: 0,
  timeoutMs: 20000,
  run: async ({ params = {} }) => {
    const r = await xhhQuery(params.keyword, { timeoutMs: 15000 })
    return r.ok ? { ok: true, data: r.text } : { ok: false, code: r.code, error: r.error }
  },
})
