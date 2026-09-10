/**
 * 闭位和弦指法模式表（规格 §6/§7）：三和弦与七和弦分别建表，左右手独立，
 * 不通过镜像推导。所有模式均为「低→高」的手指编号序列（1 = 拇指 … 5 = 小指），
 * 与 `getChordNotes().pitches` 一一对应。
 */

/** 手别 */
export type Hand = 'right' | 'left'

/** 手指编号序列（低→高），如 [1, 3, 5] = 右手原位三和弦 1-3-5 */
export type FingeringPattern = readonly number[]

/** 按转位索引的模式表：patterns[inversion] */
export type InversionPatterns = readonly FingeringPattern[]

/**
 * 三和弦标准闭位指法（规格 §6）：
 * - 右手原位 1-3-5；第一转位仍 1-3-5（低音变三音，相邻间隔不变）；第二转位 1-2-5
 *   （低音与五音间出现四度，3 指换 2 指更自然）；
 * - 左手独立建表：原位与第一转位 5-3-1，第二转位 5-3-1（G-C-E 型：5-3-1 舒适）。
 */
export const TRIAD_PATTERNS: Readonly<Record<Hand, InversionPatterns>> = {
  right: [
    [1, 3, 5], // 原位（根音在低）
    [1, 3, 5], // 第一转位（三音在低）
    [1, 2, 5], // 第二转位（五音在低）
  ],
  left: [
    [5, 3, 1],
    [5, 3, 1],
    [5, 3, 1],
  ],
}

/**
 * 七和弦标准指法（规格 §7 的右手参考模式原样落表）：
 * - RH：原位 1-2-3-5、第一转位 1-2-4-5、第二转位 1-2-3-5、第三转位 1-2-3-4；
 * - LH 独立规则表（不镜像）：原位/第一转位 5-3-2-1；第二转位（5-7-1-3 型）与
 *   第三转位（7-1-3-5 型）最低两音相距二度、需要 5-4 相邻，取 5-4-2-1。
 */
export const SEVENTH_PATTERNS: Readonly<Record<Hand, InversionPatterns>> = {
  right: [
    [1, 2, 3, 5],
    [1, 2, 4, 5],
    [1, 2, 3, 5],
    [1, 2, 3, 4],
  ],
  left: [
    [5, 3, 2, 1],
    [5, 3, 2, 1],
    [5, 4, 2, 1],
    [5, 4, 2, 1],
  ],
}

/** 按类别取基准模式表；未知类别抛 RangeError */
export function basePatterns(category: 'triad' | 'seventh', hand: Hand): InversionPatterns {
  const table = category === 'triad' ? TRIAD_PATTERNS : SEVENTH_PATTERNS
  const patterns = table[hand]
  // 不可达：两表均覆盖左右手（防御性兜底）
  if (patterns === undefined) throw new RangeError(`未知手别：${hand}`)
  return patterns
}
