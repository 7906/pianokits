/**
 * 和弦符号解析（规格 §3）：`parseChordSymbol('F#m7b5')` → `{ root: 'F#', quality: 'halfDiminished7' }`。
 *
 * 第一版只覆盖 MVP 和弦符号（大/小/减/增/挂留/四种七和弦），不做完整爵士符号解析器。
 * 根音支持升降号（`#`/`b` 及 ♯/♭）；根音保留用户拼写（`C#` 与 `Db` 等价但原样返回）。
 * 非法符号抛 ChordParseError（而不是返回 null），调用方可以区别「解析失败」与「空结果」。
 */

import { CHORD_QUALITIES, type ChordQualityId } from './quality'

/** 根音名：字母 A–G 加可选升/降号，如 'C'、'F#'、'Bb' */
export type NoteName = string

/** 音名 → 半音类（0 = C）。含 Cb/Fb/E#/B# 等理论音名 */
const NOTE_NAME_TO_PC: ReadonlyMap<string, number> = buildNoteNameToPc()

function buildNoteNameToPc(): Map<string, number> {
  const base: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
  const map = new Map<string, number>()
  for (const [letter, pc] of Object.entries(base)) {
    map.set(letter, pc)
    map.set(`${letter}#`, (pc + 1) % 12)
    map.set(`${letter}b`, (pc + 11) % 12)
  }
  return map
}

const ACCIDENTAL_TO_SEMITONE: Readonly<Record<string, number>> = {
  '#': 1,
  '♯': 1,
  b: -1,
  '♭': -1,
}

/** 和弦符号解析失败（空串、未知根音、未知符号后缀等） */
export class ChordParseError extends Error {
  /** 原始输入符号 */
  readonly symbol: string

  constructor(message: string, symbol: string) {
    super(message)
    this.name = 'ChordParseError'
    this.symbol = symbol
  }
}

/** 是否为合法根音名（严格拼写：规范升号 '#' 与降号 'b'，不含 ♯/♭） */
export function isNoteName(name: string): boolean {
  return NOTE_NAME_TO_PC.has(name)
}

/** 音名 → 半音类（0–11）；非法音名抛 RangeError */
export function noteNameToPc(name: NoteName): number {
  const pc = NOTE_NAME_TO_PC.get(name)
  if (pc === undefined) throw new RangeError(`非法音名：${name}`)
  return pc
}

export interface ParsedChordSymbol {
  /** 根音（保留输入拼写，如 'F#'、'Bb'） */
  root: NoteName
  quality: ChordQualityId
}

/**
 * 和弦符号解析结果后缀表：按「长度降序」匹配（'maj7' 先于 'm'/'7'）。
 * 同一质量可由多个符号触发（aug 与 + 等），跨条目共享 quality id。
 */
const SUFFIX_TABLE: ReadonlyArray<readonly [suffix: string, quality: ChordQualityId]> = [
  ...CHORD_QUALITIES.flatMap((q) => q.symbols.filter((s) => s !== '').map((s) => [s, q.id] as const)),
].sort((a, b) => b[0].length - a[0].length)

const ROOT_RE = /^([A-Ga-g])([#b♯♭]?)([\s\S]*)$/

/**
 * 解析和弦符号。规范示例（规格 §3）：
 * `C` `Cm` `Cdim` `Caug`/`C+` `Csus2` `Csus4` `C7` `Cmaj7` `Cm7` `Cm7b5` `F#m7b5` `Bbmaj7`
 *
 * - 根音字母不区分大小写（`cm` = `Cm`），升降号统一为规范拼写（`C♯` → `C#`）；
 * - 空后缀 = 大三和弦；未知后缀抛 ChordParseError；
 * - 空串 / 非法首字母同样抛 ChordParseError。
 */
export function parseChordSymbol(symbol: string): ParsedChordSymbol {
  const input = symbol.trim()
  const m = ROOT_RE.exec(input)
  if (m === null) {
    throw new ChordParseError(`无法识别的和弦符号：${JSON.stringify(symbol)}`, symbol)
  }
  const letter = m[1].toUpperCase()
  const rawAccidental = m[2]
  const suffix = m[3].trim()

  // 根音规范拼写：保留升降号取向（'Bb' 不折成 'A#'），仅统一大小写与 ♯/♭ 记号
  const acc = rawAccidental === '' ? 0 : ACCIDENTAL_TO_SEMITONE[rawAccidental]
  if (acc === undefined) throw new ChordParseError(`未知变音记号：${rawAccidental}`, symbol)
  const canonicalRoot = letter + (acc === 1 ? '#' : acc === -1 ? 'b' : '')
  if (!isNoteName(canonicalRoot)) {
    // 不可达：A–G + 单个升降号必为合法音名（防御性兜底）
    throw new ChordParseError(`非法根音拼写：${canonicalRoot}`, symbol)
  }

  if (suffix === '') return { root: canonicalRoot, quality: 'major' }
  const hit = SUFFIX_TABLE.find(([s]) => s === suffix)
  if (hit === undefined) {
    throw new ChordParseError(`无法识别的和弦类型后缀：${JSON.stringify(suffix)}`, symbol)
  }
  return { root: canonicalRoot, quality: hit[1] }
}
