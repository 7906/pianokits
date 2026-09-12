/**
 * 和弦识别（弹奏音集合 → 和弦名）：实时识别模式（Phase 9）与魔方图共用的纯函数。
 *
 * 规则：取按住音高的音级集合（去重、折到 0–11），与目标质量的音级模板做
 * **集合相等**匹配——转位、八度叠加、开放/密集排列都不影响结果；多一个音、
 * 少一个音则不匹配（宁可不识别，不误报）。第一版只识别魔方图上的三类：
 * 大三、小三、属七。
 */

import { getChordQuality } from './quality'
import { noteNameToPc, type NoteName } from './parse'

/** 魔方图 / 实时识别第一版支持的质量 */
export const DETECT_QUALITIES = ['major', 'minor', 'dominant7'] as const

export type DetectedQuality = (typeof DETECT_QUALITIES)[number]

export interface DetectedChord {
  root: NoteName
  quality: DetectedQuality
}

/** 规范根音拼写 → 五度圈顺序（魔方图扇区序，C 在顶部、顺时针纯五度；降号侧用降号拼写） */
export const FIFTHS_ORDER: readonly NoteName[] = [
  'C',
  'G',
  'D',
  'A',
  'E',
  'B',
  'F#',
  'Db',
  'Ab',
  'Eb',
  'Bb',
  'F',
]

/**
 * 识别按住的音高集合。无匹配（音数不足、含和弦外音、非三类质量）返回 null。
 * 音级集合语义：同一音的八度重复不影响；转位不影响（识别的是音级内容，
 * 转位信息对"我在弹哪个和弦"没有意义）。根音按五度圈顺序遍历，识别结果的
 * 拼写与魔方图节点一致（黑键侧 F#/Db/Ab/Eb/Bb 用降号，升号侧只留 F#）。
 */
export function detectChord(pitches: Iterable<number>): DetectedChord | null {
  const pcs = new Set([...pitches].map((p) => ((p % 12) + 12) % 12))
  if (pcs.size < 3 || pcs.size > 4) return null
  for (const quality of DETECT_QUALITIES) {
    const intervals = getChordQuality(quality).intervals
    for (const root of FIFTHS_ORDER) {
      const rootPc = noteNameToPc(root)
      const template = intervals.map((i) => (rootPc + i) % 12)
      if (template.some((pc) => !pcs.has(pc))) continue
      // 集合相等：模板音级都按住了，且数量一致（开头已限定 3/4 音）→ 命中
      if (template.length === pcs.size) return { root, quality }
    }
  }
  return null
}
