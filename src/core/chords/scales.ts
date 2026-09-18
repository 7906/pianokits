/**
 * 调式/音阶定义（手碟模式与后续即兴功能的数据层）。
 *
 * 手碟的玩法本质是「调式即调色盘」——整只碟只装一个调式的音，怎么敲都协和。
 * 这里把同样的约束搬上钢琴：给出主音 + 调式 → 音级集合（88 键高亮依据）+
 * 调内三和弦推导（教学展示）。
 */

import { noteNameToPc, type NoteName } from './parse'
import { FIFTHS_ORDER } from './chord-detect'
import type { ChordQualityId } from './quality'

export interface ScaleDef {
  id: string
  /** 中文显示名 */
  label: string
  /** 相对主音的半音（升序，首项 0） */
  intervals: readonly number[]
  /** 音级数（7 = 可推导调内三和弦；5 = 五声，跳过三和弦推导） */
  noteCount: number
}

/** 手碟模式的调式菜单：大小调系 + 手碟常见色彩 */
export const SCALES: readonly ScaleDef[] = [
  { id: 'major', label: '大调', intervals: [0, 2, 4, 5, 7, 9, 11], noteCount: 7 },
  { id: 'naturalMinor', label: '自然小调', intervals: [0, 2, 3, 5, 7, 8, 10], noteCount: 7 },
  { id: 'dorian', label: '多利亚', intervals: [0, 2, 3, 5, 7, 9, 10], noteCount: 7 },
  { id: 'mixolydian', label: '混合利底亚', intervals: [0, 2, 4, 5, 7, 9, 10], noteCount: 7 },
  { id: 'phrygian', label: '弗里吉亚', intervals: [0, 1, 3, 5, 7, 8, 10], noteCount: 7 },
  { id: 'minorPentatonic', label: '小调五声', intervals: [0, 3, 5, 7, 10], noteCount: 5 },
  { id: 'majorPentatonic', label: '大调五声', intervals: [0, 2, 4, 7, 9], noteCount: 5 },
]

/** 按 id 取调式；未知 id 抛 RangeError */
export function getScale(id: string): ScaleDef {
  const s = SCALES.find((x) => x.id === id)
  if (s === undefined) throw new RangeError(`未知调式：${id}`)
  return s
}

/** 主音半音类 + 调式 → 音级集合（0–11） */
export function scalePitchClasses(tonicPc: number, scale: ScaleDef): Set<number> {
  return new Set(scale.intervals.map((i) => (((tonicPc + i) % 12) + 12) % 12))
}

export interface DiatonicTriad {
  root: NoteName
  quality: ChordQualityId
  /** 显示符号，如 Dm / G / Bdim */
  symbol: string
  /** 调内级数（0 基，0 = 主和弦） */
  degreeIndex: number
}

const TRIAD_QUALITY: Readonly<Record<string, ChordQualityId>> = {
  '3,7': 'minor',
  '4,7': 'major',
  '3,6': 'diminished',
  '4,8': 'augmented',
}

const TRIAD_SUFFIX: Readonly<Record<ChordQualityId, string>> = {
  major: '',
  minor: 'm',
  diminished: 'dim',
  augmented: 'aug',
  sus2: 'sus2',
  sus4: 'sus4',
  dominant7: '7',
  major7: 'maj7',
  minor7: 'm7',
  halfDiminished7: 'm7b5',
  diminished7: '°7',
  // 调内三和弦只产生上表质量，六和弦后缀仅为满足穷举（不会被用到）
  major6: '6',
  minor6: 'm6',
}

/**
 * 七声调式的调内三和弦：按音级叠三度（i, i+2, i+4），识别大小/减/增。
 * 根音拼写按五度圈约定（黑键侧 F#/Db/Ab/Eb/Bb）。五声调式返回空数组。
 */
export function diatonicTriads(tonicPc: number, scale: ScaleDef): DiatonicTriad[] {
  if (scale.noteCount !== 7) return []
  const pcs = scale.intervals.map((i) => (((tonicPc + i) % 12) + 12) % 12)
  const out: DiatonicTriad[] = []
  for (let d = 0; d < scale.noteCount; d++) {
    const root = pcs[d]
    const third = pcs[(d + 2) % scale.noteCount]
    const fifth = pcs[(d + 4) % scale.noteCount]
    const key = `${(((third - root) % 12) + 12) % 12},${(((fifth - root) % 12) + 12) % 12}`
    const quality = TRIAD_QUALITY[key]
    if (quality === undefined) continue
    const rootName = FIFTHS_ORDER.find((r) => noteNameToPc(r) === root)
    if (rootName === undefined) continue
    out.push({
      root: rootName,
      quality,
      symbol: `${rootName}${TRIAD_SUFFIX[quality]}`,
      degreeIndex: d,
    })
  }
  return out
}
