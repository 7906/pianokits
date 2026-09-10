import { describe, expect, it } from 'vitest'

import { noteNameToPc } from './parse'
import { BASE_ROOT_PITCH, getChordNotes } from './notes'
import { CHORD_QUALITIES, getChordQuality, type ChordQualityId } from './quality'

const ROOTS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const
const FLAT_ROOTS = ['Db', 'Eb', 'Gb', 'Ab', 'Bb'] as const

describe('getChordNotes：12 根音 × 全部质量 × 全部转位', () => {
  for (const quality of CHORD_QUALITIES) {
    for (const inversion of [0, 1, 2, 3].slice(0, quality.supportedInversions + 1)) {
      it.each(ROOTS)(`%s${quality.symbols[0]} 转位 ${inversion}`, (root) => {
        const n = getChordNotes(root, quality, inversion)
        // 音符数量
        expect(n.pitches.length).toBe(quality.noteCount)
        // 低→高严格升序
        for (let i = 1; i < n.pitches.length; i++) {
          expect(n.pitches[i]).toBeGreaterThan(n.pitches[i - 1])
        }
        // 音高集合 = 根音半音类 + 各音程（mod 12），与顺序无关
        const rootPc = noteNameToPc(root)
        const expectedPcs = new Set(quality.intervals.map((i) => (rootPc + i) % 12))
        expect(new Set(n.pitches.map((p) => ((p % 12) + 12) % 12))).toEqual(expectedPcs)
        // 转位语义：相邻音程与「原位循环移位」一致（音随音移动，音程结构保持）
        expect(n.degrees.length).toBe(quality.noteCount)
        expect(n.degrees).toEqual([
          ...quality.noteDegrees.slice(inversion),
          ...quality.noteDegrees.slice(0, inversion),
        ])
        const gaps = (ps: readonly number[]): number[] => ps.slice(1).map((p, i) => p - ps[i])
        const lifted = quality.intervals.slice(0, inversion).map((i) => i + 12)
        const expectedSeq = [...quality.intervals.slice(inversion), ...lifted]
        expect(gaps(n.pitches)).toEqual(gaps(expectedSeq))
        // MIDI 边界：88 键范围内（21–108），且不越过 0–127
        for (const p of n.pitches) {
          expect(p).toBeGreaterThanOrEqual(21)
          expect(p).toBeLessThanOrEqual(108)
        }
      })
    }
  }
})

describe('getChordNotes：原位基点与转位规则', () => {
  it('原位根音落在 60–71（第 4 八度区）', () => {
    for (const root of ROOTS) {
      const n = getChordNotes(root, 'major')
      expect(n.pitches[0]).toBe(BASE_ROOT_PITCH + noteNameToPc(root))
    }
  })

  it('C 大三和弦三个转位的准确音高', () => {
    expect(getChordNotes('C', 'major', 0).pitches).toEqual([60, 64, 67])
    expect(getChordNotes('C', 'major', 1).pitches).toEqual([64, 67, 72])
    expect(getChordNotes('C', 'major', 2).pitches).toEqual([67, 72, 76])
  })

  it('第一转位把最低音移到顶部（规格 §4）', () => {
    const root = getChordNotes('F', 'major7', 0).pitches
    const inv1 = getChordNotes('F', 'major7', 1).pitches
    expect(inv1).toEqual([root[1], root[2], root[3], root[0] + 12])
  })

  it('七和弦第三转位（规格 §4：七和弦支持第三转位）', () => {
    const root = getChordNotes('G', 'dominant7', 0).pitches
    const inv3 = getChordNotes('G', 'dominant7', 3).pitches
    expect(inv3).toEqual([root[3], root[0] + 12, root[1] + 12, root[2] + 12])
    expect(inv3[0]).toBeLessThan(inv3[1])
  })

  it('降号根音与升号根音等价（Bb = A#）', () => {
    for (const quality of CHORD_QUALITIES) {
      const sharp = getChordNotes('A#', quality)
      const flat = getChordNotes('Bb', quality)
      expect(flat.pitches).toEqual(sharp.pitches)
    }
  })

  it('FLAT_ROOTS 全部质量可用', () => {
    for (const root of FLAT_ROOTS) {
      for (const quality of CHORD_QUALITIES) {
        const n = getChordNotes(root, quality)
        expect(n.pitches.length).toBe(quality.noteCount)
      }
    }
  })

  it('quality 可传完整 ChordQuality 对象', () => {
    expect(getChordNotes('C', getChordQuality('major')).pitches).toEqual([60, 64, 67])
  })
})

describe('getChordNotes：非法输入', () => {
  it('非法根音抛 RangeError', () => {
    expect(() => getChordNotes('H', 'major')).toThrow(RangeError)
    expect(() => getChordNotes('', 'major')).toThrow(RangeError)
  })

  it('未知质量抛 RangeError', () => {
    expect(() => getChordNotes('C', 'nope' as ChordQualityId)).toThrow(RangeError)
  })

  it('非法转位抛 RangeError（负数 / 超过 supportedInversions / 非整数）', () => {
    expect(() => getChordNotes('C', 'major', -1)).toThrow(RangeError)
    expect(() => getChordNotes('C', 'major', 3)).toThrow(RangeError)
    expect(() => getChordNotes('C', 'dominant7', 4)).toThrow(RangeError)
    expect(() => getChordNotes('C', 'major', 1.5)).toThrow(RangeError)
  })
})
