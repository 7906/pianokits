/**
 * 指法 Profile（规格 §5/§13）：standard profile 稳定不变；个人差异（如手小）
 * 通过独立 profile 表达；个别和弦的偏好通过例外覆盖（override）实现——
 * 禁止把个人偏好写进 standard，也禁止为每个和弦手工建完整指法数据。
 *
 * override 键：`${qualityId}/${hand}/${inversion}`，值：完整手指序列（低→高）。
 */

import { getChordQuality, type ChordCategory } from '../chords/quality'
import { basePatterns, type FingeringPattern, type Hand } from './patterns'

export type FingeringProfileId = 'standard' | 'small-hand' | 'custom'

export type FingeringOverrideKey = string

export interface FingeringProfile {
  readonly id: FingeringProfileId
  /** 类别 × 手别 → 基准模式（按转位索引） */
  readonly patterns: Readonly<Record<ChordCategory, Readonly<Record<Hand, FingeringPattern[]>>>>
  /** 例外覆盖：`${qualityId}/${hand}/${inversion}` → 手指序列 */
  readonly overrides: ReadonlyMap<FingeringOverrideKey, FingeringPattern>
}

/** 标准闭位基准表（引用 patterns.ts 的常量，standard 永不因个人偏好修改） */
const STANDARD_PATTERNS: Readonly<
  Record<ChordCategory, Readonly<Record<Hand, FingeringPattern[]>>>
> = {
  triad: { right: [...basePatterns('triad', 'right')], left: [...basePatterns('triad', 'left')] },
  seventh: {
    right: [...basePatterns('seventh', 'right')],
    left: [...basePatterns('seventh', 'left')],
  },
}

/** 三和弦模式中位于中段的 3 指（如 1-3-5、5-3-1）换为 2 指，缓解小手拉伸 */
function softenMiddle3(p: FingeringPattern): FingeringPattern {
  return p.map((f, i) => (f === 3 && i > 0 && i < p.length - 1 ? 2 : f))
}

/**
 * small-hand profile（规格 §6「允许 small-hand 将部分标准 1-3-5 改为 1-2-5」）：
 * 仅把三和弦模式中段的三指（1-3-5 / 5-3-1）放宽为 1-2-5 / 5-2-1；
 * 七和弦本就少用 3 指承重，保持标准表不变。
 */
const SMALL_HAND_PATTERNS: Readonly<
  Record<ChordCategory, Readonly<Record<Hand, FingeringPattern[]>>>
> = {
  triad: {
    right: STANDARD_PATTERNS.triad.right.map(softenMiddle3),
    left: STANDARD_PATTERNS.triad.left.map(softenMiddle3),
  },
  seventh: STANDARD_PATTERNS.seventh,
}

/** standard profile：标准闭位指法，全员稳定共享 */
export const STANDARD_PROFILE: FingeringProfile = {
  id: 'standard',
  patterns: STANDARD_PATTERNS,
  overrides: new Map(),
}

/** small-hand profile：三和弦中段 3 → 2 的放宽版 */
export const SMALL_HAND_PROFILE: FingeringProfile = {
  id: 'small-hand',
  patterns: SMALL_HAND_PATTERNS,
  overrides: new Map(),
}

const BY_ID = new Map<FingeringProfileId, FingeringProfile>([
  ['standard', STANDARD_PROFILE],
  ['small-hand', SMALL_HAND_PROFILE],
])

/** 按 id 取内置 profile；未知 id 抛 RangeError */
export function getBuiltinProfile(id: string): FingeringProfile {
  const p = BY_ID.get(id as FingeringProfileId)
  if (p === undefined) throw new RangeError(`未知指法 profile：${id}`)
  return p
}

/**
 * 创建 custom profile：以 standard 为基底，叠加调用方给出的例外覆盖。
 * override 键 `${qualityId}/${hand}/${inversion}`，值须为 1–5 的手指序列。
 * 这里只做形状校验（长度与数值范围），语义正确性由调用方保证。
 */
export function createCustomProfile(
  overrides: Iterable<readonly [FingeringOverrideKey, readonly number[]]>,
): FingeringProfile {
  const map = new Map<FingeringOverrideKey, FingeringPattern>()
  for (const [key, fingers] of overrides) {
    validateFingers(fingers)
    map.set(key, fingers)
  }
  return { id: 'custom', patterns: STANDARD_PATTERNS, overrides: map }
}

/** 手指序列形状校验：每项为 1–5 的整数 */
export function validateFingers(fingers: readonly number[]): void {
  if (fingers.length === 0 || fingers.some((f) => !Number.isInteger(f) || f < 1 || f > 5)) {
    throw new RangeError(`非法手指序列：${JSON.stringify(fingers)}（须为 1–5 的整数）`)
  }
}

/** 构造 override 键 */
export function overrideKey(quality: string, hand: Hand, inversion: number): string {
  // 触发对未知质量的校验（键里存 id 字符串）
  getChordQuality(quality)
  return `${quality}/${hand}/${inversion}`
}
