/**
 * 和弦音符生成（规格 §4）：`getChordNotes` 由根音 + 质量 + 转位生成低→高的
 * MIDI 音高序列。纯函数，无 DOM / Web MIDI 依赖。
 *
 * 排列规则：
 * - 原位以根音为最低音（置于第 4 八度区 60–71），按根音、三音、五音、七音闭位排列；
 * - 第 k 转位 = 把最低的 k 个音逐个移高八度（第一转位把最低音移到顶部，依此循环）；
 * - 七和弦支持第三转位；转位数超出 `supportedInversions` 抛 RangeError。
 *
 * 根音基点取 60–71，保证任何 12 根音 × 全部质量 × 全部转位的音高都落在
 * 88 键范围（21–108）内（测试锁定该边界）。
 */

import { getChordQuality, type ChordQuality, type ChordQualityId } from './quality'
import { noteNameToPc, type NoteName } from './parse'

/** 原位根音所在的最低 MIDI 音高：根音落在 [BASE_ROOT_PITCH, BASE_ROOT_PITCH + 11] */
export const BASE_ROOT_PITCH = 60 // C4

export interface ChordNotes {
  /** 低→高 MIDI 音高（闭位排列，长度 = noteCount） */
  readonly pitches: readonly number[]
  /** 与 pitches 一一对应的音级名（'1' = 根音，'b3' = 小三度…；转位后随音移动） */
  readonly degrees: readonly string[]
  /** 根音音名（原样返回输入拼写） */
  readonly root: NoteName
  readonly quality: ChordQualityId
  readonly inversion: number
}

/**
 * 生成和弦音符。root 为音名（'C'、'F#'、'Bb'…，接受升降号），quality 可传
 * ChordQualityId 或完整 ChordQuality，inversion 为转位数（0 = 原位）。
 *
 * 非法根音（RangeError 来自 noteNameToPc）、未知质量、越界转位均抛异常，
 * 调用方（UI / 测试）据此区分合法与非法输入。
 */
export function getChordNotes(
  root: NoteName,
  quality: ChordQualityId | ChordQuality,
  inversion = 0,
): ChordNotes {
  const q = typeof quality === 'string' ? getChordQuality(quality) : quality
  if (!Number.isInteger(inversion) || inversion < 0 || inversion > q.supportedInversions) {
    throw new RangeError(
      `和弦 ${root}${q.symbols[0]} 不支持转位 ${inversion}（有效范围 0–${q.supportedInversions}）`,
    )
  }
  const base = BASE_ROOT_PITCH + noteNameToPc(root)
  // 原位闭位：根音 + 各音程（升序，intervals[0] = 0）
  const tones = q.intervals.map((i) => base + i)
  // 第 k 转位：最低 k 个音逐个移高八度（第一转位把最低音移到顶部，依此循环）
  const moved = [...tones.slice(inversion), ...tones.slice(0, inversion).map((p) => p + 12)]
  const degrees = [...q.noteDegrees.slice(inversion), ...q.noteDegrees.slice(0, inversion)]
  return {
    pitches: moved,
    degrees,
    root,
    quality: q.id,
    inversion,
  }
}
