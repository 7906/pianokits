/**
 * 和弦质量（ChordQuality）定义：数据驱动，禁止在 UI 中硬编码音程。
 *
 * 每个质量包含：稳定 id、显示符号、相对根音的半音程、音级名、音符数、类别与
 * 支持的转位数。第一版覆盖 6 种三和弦（含挂留）与 4 种七和弦；六和弦等作为
 * 第二阶段扩展——新增和弦只需在本表加一条数据，解析 / 音符 / 指法自动获得支持。
 */

export type ChordQualityId =
  | 'major'
  | 'minor'
  | 'diminished'
  | 'augmented'
  | 'sus2'
  | 'sus4'
  | 'dominant7'
  | 'major7'
  | 'minor7'
  | 'halfDiminished7'

/** 和弦类别：决定使用三和弦还是七和弦指法规则表 */
export type ChordCategory = 'triad' | 'seventh'

export interface ChordQuality {
  /** 稳定 id（持久化 / 测试参数化用） */
  readonly id: ChordQualityId
  /** 显示与检索符号（第一个为规范符号），如 minor → ['m', 'min', '-'] */
  readonly symbols: readonly string[]
  /** 相对根音的半音程（升序，首项恒为 0） */
  readonly intervals: readonly number[]
  /** 音级名（与 intervals 一一对应），如 minor → ['1', 'b3', '5'] */
  readonly noteDegrees: readonly string[]
  /** 音符数 = intervals.length */
  readonly noteCount: number
  /** 类别（三和弦 / 七和弦，指法规则按此分表） */
  readonly category: ChordCategory
  /** 支持的转位数（原位 0 + 低音移顶次数 = noteCount - 1） */
  readonly supportedInversions: number
}

/** 三和弦（3 音，2 个转位）的通用构造，避免手写重复字段 */
function triad(
  id: ChordQualityId,
  symbols: string[],
  intervals: number[],
  noteDegrees: string[],
): ChordQuality {
  return {
    id,
    symbols,
    intervals,
    noteDegrees,
    noteCount: intervals.length,
    category: 'triad',
    supportedInversions: intervals.length - 1,
  }
}

/** 七和弦（4 音，3 个转位）的通用构造 */
function seventh(
  id: ChordQualityId,
  symbols: string[],
  intervals: number[],
  noteDegrees: string[],
): ChordQuality {
  return {
    id,
    symbols,
    intervals,
    noteDegrees,
    noteCount: intervals.length,
    category: 'seventh',
    supportedInversions: intervals.length - 1,
  }
}

/** 第一版支持的全部和弦质量（规格 §2） */
export const CHORD_QUALITIES: readonly ChordQuality[] = [
  triad('major', ['', 'maj'], [0, 4, 7], ['1', '3', '5']),
  triad('minor', ['m', 'min', '-'], [0, 3, 7], ['1', 'b3', '5']),
  triad('diminished', ['dim', '°'], [0, 3, 6], ['1', 'b3', 'b5']),
  triad('augmented', ['aug', '+'], [0, 4, 8], ['1', '3', '#5']),
  triad('sus2', ['sus2'], [0, 2, 7], ['1', '2', '5']),
  triad('sus4', ['sus4', 'sus'], [0, 5, 7], ['1', '4', '5']),
  seventh('dominant7', ['7'], [0, 4, 7, 10], ['1', '3', '5', 'b7']),
  seventh('major7', ['maj7', 'M7', 'Δ7'], [0, 4, 7, 11], ['1', '3', '5', '7']),
  seventh('minor7', ['m7', 'min7', '-7'], [0, 3, 7, 10], ['1', 'b3', '5', 'b7']),
  seventh('halfDiminished7', ['m7b5', 'min7b5', '-7b5', 'ø', 'ø7'], [0, 3, 6, 10], ['1', 'b3', 'b5', 'b7']),
]

const BY_ID = new Map<string, ChordQuality>(CHORD_QUALITIES.map((q) => [q.id, q]))

/** 按 id 取和弦质量；未知 id 抛 RangeError */
export function getChordQuality(id: string): ChordQuality {
  const q = BY_ID.get(id)
  if (q === undefined) throw new RangeError(`未知和弦类型：${id}`)
  return q
}

/** 全部支持的转位数列表（0..supportedInversions），供 UI / 测试枚举 */
export function allInversions(q: ChordQuality): number[] {
  return Array.from({ length: q.supportedInversions + 1 }, (_, i) => i)
}
