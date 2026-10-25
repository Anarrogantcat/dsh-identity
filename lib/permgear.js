/**
 * 权限档位：一键切换「严格 / 标准 / 开放」
 * 有些人愿意把整台机器交给 AI（开放），有些人只想让她在群里聊聊天（严格）。
 * 注意：开放≠裸奔 —— 出站「真实凭据兜底」默认仍然开着，可在面板单独关。
 */
export const PERM_LEVELS = {
  strict: {
    name: '严格',
    desc: '群里只聊天：工具全禁、只能访问工作区、套话直接丢',
    patch: {
      'tools.fullAccess': false,
      'tools.mode': 'owner-only',
      'tools.restrictToWorkspace': true,
      'privacy.guardPrompts': true,
      'privacy.guardMode': 'drop',
      'privacy.blockDangerIntent': true,
      'privacy.redactOutbound': true,
      'privacy.memoryRedact': true,
    },
  },
  standard: {
    name: '标准',
    desc: '群内只放行搜索类工具；路径限工作区；套话回一句固定话术',
    patch: {
      'tools.fullAccess': false,
      'tools.mode': 'allowlist',
      'tools.restrictToWorkspace': true,
      'privacy.guardPrompts': true,
      'privacy.guardMode': 'reply',
      'privacy.blockDangerIntent': true,
      'privacy.redactOutbound': true,
      'privacy.memoryRedact': true,
    },
  },
  open: {
    name: '开放',
    desc: '全权交给 AI：工具不限、可访问任意路径、不拦套话（真实凭据兜底仍开）',
    patch: {
      'tools.fullAccess': true,
      'tools.mode': 'open',
      'tools.restrictToWorkspace': false,
      'privacy.guardPrompts': false,
      'privacy.guardMode': 'reply',
      'privacy.blockDangerIntent': false,
      'privacy.redactOutbound': false,
      'privacy.memoryRedact': false,
    },
  },
}

export function levelOf(level) {
  return PERM_LEVELS[level] ?? null
}
