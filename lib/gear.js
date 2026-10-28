/**
 * 自然接话挡位（1 很安静 … 5 很活跃）
 * 一挡 = 一组参数，面板点一下整组写入；之后仍可单独微调
 */
export const GEARS = {
  1: { name: '很安静', stickyMin: 2, selfGapSec: 60, fitThreshold: 0.5, naturalPerHour: 3, naturalPerDay: 10, naturalCooldownSec: 600 },
  2: { name: '安静', stickyMin: 3, selfGapSec: 45, fitThreshold: 0.45, naturalPerHour: 5, naturalPerDay: 20, naturalCooldownSec: 300 },
  3: { name: '正常', stickyMin: 5, selfGapSec: 30, fitThreshold: 0.35, naturalPerHour: 8, naturalPerDay: 30, naturalCooldownSec: 120 },
  4: { name: '活跃', stickyMin: 8, selfGapSec: 20, fitThreshold: 0.3, naturalPerHour: 12, naturalPerDay: 50, naturalCooldownSec: 60 },
  5: { name: '很活跃', stickyMin: 12, selfGapSec: 10, fitThreshold: 0.25, naturalPerHour: 20, naturalPerDay: 80, naturalCooldownSec: 30 },
}

export function gearValues(gear) {
  return GEARS[Number(gear)] ?? null
}

export function defaultGear() {
  return 3
}
