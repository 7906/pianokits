/**
 * 指法引擎（规格 §5）：`getChordFingering` 由「根音 + 质量 + 转位 + 手别 + profile」
 * 得出与 `getChordNotes().pitches` 一一对应的手指编号序列（低→高）。
 *
 * 实现 = 规则（三和弦 / 七和弦两张模式表）+ profile（standard / small-hand / custom）
 * + 例外覆盖（override 键 `${qualityId}/${hand}/${inversion}`，profile 内置覆盖与
 * 调用方临时覆盖都支持）。不为每个和弦建一条手工数据；不依赖 DOM / Web MIDI。
 */

import { getChordQuality, type ChordQualityId } from '../chords/quality'
import type { NoteName } from '../chords/parse'
import {
  getBuiltinProfile,
  overrideKey,
  validateFingers,
  type FingeringOverrideKey,
  type FingeringProfile,
} from './profile'
import type { FingeringPattern, Hand } from './patterns'

export interface ChordFingeringRequest {
  root: NoteName
  quality: ChordQualityId
  inversion: number
  hand: Hand
  /** profile id 或完整 profile 对象；缺省 = standard。未知 id 运行时抛 RangeError */
  profile?: string | FingeringProfile
  /** 调用方临时例外覆盖（优先级高于 profile 内置覆盖） */
  overrides?: Iterable<readonly [FingeringOverrideKey, readonly number[]]>
}

export interface ChordFingering {
  /** 低→高手指编号（与 getChordNotes().pitches 一一对应） */
  readonly fingers: readonly number[]
  readonly root: NoteName
  readonly quality: ChordQualityId
  readonly inversion: number
  readonly hand: Hand
  /** 指法来源：profile 基准模式 / 例外覆盖 */
  readonly source: 'pattern' | 'override'
}

/**
 * 取和弦指法。非法输入（未知质量 / profile、越界转位、非法手别、形状错误的
 * 覆盖序列）抛 RangeError / TypeError，供测试与 UI 上层区分。
 */
export function getChordFingering(req: ChordFingeringRequest): ChordFingering {
  const q = getChordQuality(req.quality)
  const hand = req.hand
  if (hand !== 'right' && hand !== 'left') throw new RangeError(`未知手别：${String(hand)}`)
  if (!Number.isInteger(req.inversion) || req.inversion < 0 || req.inversion > q.supportedInversions) {
    throw new RangeError(
      `和弦 ${req.root}${q.symbols[0]} 不支持转位 ${req.inversion}（有效范围 0–${q.supportedInversions}）`,
    )
  }
  const profile =
    typeof req.profile === 'string' || req.profile === undefined
      ? getBuiltinProfile(req.profile ?? 'standard')
      : req.profile
  const key = overrideKey(q.id, hand, req.inversion)
  const custom = req.overrides ? findOverride(req.overrides, key) : undefined
  if (custom !== undefined) {
  return finish(q.id, req.root, req.inversion, hand, custom, 'override')
}

  const builtin = profile.overrides.get(key)
  if (builtin !== undefined) {
    return finish(q.id, req.root, req.inversion, hand, builtin, 'override')
  }

  const categoryPatterns = profile.patterns[q.category]
  const pattern = categoryPatterns?.[hand]?.[req.inversion]
  // 不可达：模式表按类别×手别×全部有效转位建满（防御性兜底）
  if (pattern === undefined) {
    throw new RangeError(`模式表缺失：${q.category}/${hand}/${req.inversion}`)
  }
  return finish(q.id, req.root, req.inversion, hand, pattern, 'pattern')
}

/** 组装结果并校验指法序列长度与和弦音符数一致 */
function finish(
  quality: ChordQualityId,
  root: NoteName,
  inversion: number,
  hand: Hand,
  fingers: readonly number[],
  source: 'pattern' | 'override',
): ChordFingering {
  const noteCount = getChordQuality(quality).noteCount
  if (fingers.length !== noteCount) {
    throw new RangeError(
      `手指序列长度 ${fingers.length} 与和弦音符数 ${noteCount} 不一致：${JSON.stringify(fingers)}`,
    )
  }
  return { fingers, root, quality, inversion, hand, source }
}

function findOverride(
  overrides: Iterable<readonly [FingeringOverrideKey, readonly number[]]>,
  key: string,
): FingeringPattern | undefined {
  for (const [k, fingers] of overrides) {
    if (k === key) {
      validateFingers(fingers)
      return fingers
    }
  }
  return undefined
}
