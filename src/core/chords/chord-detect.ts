/**
 * 和弦识别（弹奏音集合 → 和弦名）：实时识别模式（Phase 9）与魔方图共用的纯函数。
 *
 * 规则：取按住音高的音级集合（去重、折到 0–11），与目标质量的音级模板做
 * **集合相等**匹配——转位、八度叠加、开放/密集排列都不影响结果；多一个音、
 * 少一个音则不匹配（宁可不识别，不误报）。识别魔方图上的四类：
 * 大三、小三、属七、减七。
 *
 * `detectChord` 服务魔方图（四类质量、根音按五度圈序）；`detectChordFull`
 * 服务实时识别（全部 13 类质量、低音优先消歧、给出转位与同音集别解），
 * 两者互不影响——六和弦不进魔方图。
 */

import { CHORD_QUALITIES, getChordQuality, type ChordQualityId } from './quality'
import { noteNameToPc, type NoteName } from './parse'

/** 魔方图 / 实时识别支持的质量 */
export const DETECT_QUALITIES = ['major', 'minor', 'dominant7', 'diminished7'] as const

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
 * 识别按住的音高集合。无匹配（音数不足、含和弦外音、非四类质量）返回 null。
 * 音级集合语义：同一音的八度重复不影响；转位不影响（识别的是音级内容，
 * 转位信息对"我在弹哪个和弦"没有意义）。根音按五度圈顺序遍历，识别结果的
 * 拼写与魔方图节点一致（黑键侧 F#/Db/Ab/Eb/Bb 用降号，升号侧只留 F#）。
 *
 * 减七的特殊性：一个减七音集对应 4 个等音拼写（如 {B,D,F,Ab} = B°7 = D°7 =
 * F°7 = Ab°7），本函数按五度圈序返回**第一个**拼写；需要全部拼写时用
 * `detectDim7Roots`（魔方图上 4 个 ° 节点要同亮——这正是转调枢纽的教学点）。
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

/**
 * 减七识别的全部等音拼写：与按住音集相等的所有 dim7 根音（非减七音集返回空）。
 * 12 个拼写 = 3 个不同音集 × 4 个等音根音。
 */
export function detectDim7Roots(pitches: Iterable<number>): NoteName[] {
  const pcs = new Set([...pitches].map((p) => ((p % 12) + 12) % 12))
  if (pcs.size !== 4) return []
  const intervals = getChordQuality('diminished7').intervals
  return FIFTHS_ORDER.filter((root) => {
    const rootPc = noteNameToPc(root)
    const template = intervals.map((i) => (rootPc + i) % 12)
    return template.every((pc) => pcs.has(pc))
  })
}

// —— 实时识别（Phase 9）：全部质量 + 转位 + 同音集消歧 ——

/** 实时识别覆盖全部质量（六和弦含在内；魔方图的 detectChord 不受影响） */
export const DETECT_FULL_QUALITIES: readonly ChordQualityId[] = CHORD_QUALITIES.map((q) => q.id)

/** 单个识别结果：根音 + 质量 + 低音所在转位 + 规范符号 */
export interface DetectedChordFull {
  root: NoteName
  quality: ChordQualityId
  /** 低音相对根音的转位（0 = 原位，取值 = 根音下方音级在 intervals 中的序号） */
  inversion: number
  /** 规范符号（根音 + 规范后缀），如 'C6'、'Am7'、'Bb°7' */
  symbol: string
}

/** 实时识别完整结果：主判定 + 同音集的其它拼写（别解） */
export interface DetectFullResult {
  chord: DetectedChordFull
  /** 同音集其它拼写（如 C6 ↔ Am7、减七的另外 3 个等音根音）；无歧义时为空 */
  alternates: readonly DetectedChordFull[]
}

/**
 * 同音集歧义的回退优先级（低音不是任何候选根音时使用）：
 * 七和弦优先于六和弦（Am7 远比 C6 常见）、挂四优先于挂二，
 * 其余维持五度圈先序。歧义族：C6=Am7、Cm6=Am7b5、Csus2=Gsus4、
 * 增三 3 等音、减七 4 等音。
 */
const DETECT_FALLBACK_PRIORITY: readonly ChordQualityId[] = [
  'dominant7',
  'major7',
  'minor7',
  'halfDiminished7',
  'diminished7',
  'major',
  'minor',
  'major6',
  'minor6',
  'diminished',
  'augmented',
  'sus4',
  'sus2',
]

/** 构造一个「根音 × 质量 × 按住音集」的候选（不匹配返回 null） */
function fullCandidate(
  root: NoteName,
  quality: ChordQualityId,
  pcs: ReadonlySet<number>,
  bassPc: number,
): DetectedChordFull | null {
  const q = getChordQuality(quality)
  const rootPc = noteNameToPc(root)
  const template = q.intervals.map((i) => (rootPc + i) % 12)
  if (!template.every((pc) => pcs.has(pc)) || template.length !== pcs.size) return null
  const bassOffset = (bassPc - rootPc + 12) % 12
  const inversion = q.intervals.indexOf(bassOffset)
  // bassPc 必为按住音之一、音集又与模板相等 → bassPc 必在模板中（防御性兜底）
  if (inversion < 0) return null
  return { root, quality, inversion, symbol: `${root}${q.symbols[0]}` }
}

/**
 * 实时识别：全部 13 类质量 × 12 根音做音级集合相等匹配，并按**低音优先**消歧——
 *
 * - 低音是某候选的根音 → 直接采纳该候选（弹 C-E-G-A 低音 C 记 C6、低音 A 记 Am7，
 *   与「六和弦低音=根音、七和弦低音=根音」的惯用指位一致）；
 * - 低音不是任何候选根音（如 E-G-A-C）→ 按回退优先级取最常见解释（Am7 第二转位）；
 * - 转位由低音在根音音级中的位置给出（Am7/C = 第一转位）。
 *
 * 八度重复不影响（音级集合语义）。无匹配（音数不足、含和弦外音）返回 null。
 * 减七等音族按低音取根音，其余等音拼写进 `alternates`（教学展示用）。
 */
export function detectChordFull(pitches: Iterable<number>): DetectFullResult | null {
  const list = [...pitches]
  if (list.length === 0) return null
  const pcs = new Set(list.map((p) => ((p % 12) + 12) % 12))
  if (pcs.size < 3 || pcs.size > 4) return null
  const bassPc = ((Math.min(...list) % 12) + 12) % 12
  const candidates: DetectedChordFull[] = []
  for (const quality of DETECT_FULL_QUALITIES) {
    for (const root of FIFTHS_ORDER) {
      const c = fullCandidate(root, quality, pcs, bassPc)
      if (c !== null) candidates.push(c)
    }
  }
  if (candidates.length === 0) return null
  const rank = (quality: ChordQualityId): number => {
    const i = DETECT_FALLBACK_PRIORITY.indexOf(quality)
    return i < 0 ? DETECT_FALLBACK_PRIORITY.length : i
  }
  // 低音=根音的候选至多一个（同一根音下 13 类模板音集互异）
  const primary =
    candidates.find((c) => noteNameToPc(c.root) === bassPc) ??
    [...candidates].sort((a, b) => rank(a.quality) - rank(b.quality))[0]
  return { chord: primary, alternates: candidates.filter((c) => c !== primary) }
}
