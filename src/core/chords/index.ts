/** 和弦核心模块：质量定义、符号解析、音符/转位生成 */
export {
  CHORD_QUALITIES,
  allInversions,
  getChordQuality,
  type ChordCategory,
  type ChordQuality,
  type ChordQualityId,
} from './quality'
export {
  ChordParseError,
  isNoteName,
  noteNameToPc,
  parseChordSymbol,
  type NoteName,
  type ParsedChordSymbol,
} from './parse'
export { BASE_ROOT_PITCH, getChordNotes, type ChordNotes } from './notes'
