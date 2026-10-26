/**
 * 该用哪个模型：显式配置优先，留空就回落到宿主的默认模型
 *
 * 为什么要有这层：面板里 profile.llmProvider / integration.llmProvider 这类字段
 * 手填很容易填错（而且大多数人根本不知道自己部署用的是什么模型）。
 * 留空 → 读 agentDefaultModel.currentSelection()，跟网页新建会话用的是同一个。
 */
const trim = (v) => String(v ?? '').trim()

/**
 * @param {object|null} service 宿主的 agentDefaultModel 服务（可能不存在）
 * @param {string} provider 配置里的 provider（可为空）
 * @param {string} model 配置里的 model（可为空）
 * @returns {{provider:string, model:string, source:'config'|'host-default'|'none'}}
 */
export function resolveRoute(service, provider, model) {
  const p = trim(provider)
  const m = trim(model)
  if (p && m) return { provider: p, model: m, source: 'config' }
  try {
    const sel = service?.currentSelection?.() ?? null
    if (sel && sel.provider && sel.model) return { provider: String(sel.provider), model: String(sel.model), source: 'host-default' }
  } catch { /* 服务没装或还没就绪 */ }
  return { provider: p, model: m, source: 'none' }
}

/** 把解析结果写回配置副本的某个段（'profile' | 'integration'），不落盘 */
export function withRoute(cfg, section, route) {
  if (!cfg || !route || !route.provider || !route.model) return cfg
  const cur = cfg[section] ?? {}
  if (trim(cur.llmProvider) && trim(cur.llmModel)) return cfg
  return { ...cfg, [section]: { ...cur, llmProvider: route.provider, llmModel: route.model } }
}
