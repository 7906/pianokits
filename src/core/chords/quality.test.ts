import { describe, expect, it } from 'vitest'

import { CHORD_QUALITIES, allInversions, getChordQuality } from './quality'

describe('CHORD_QUALITIES', () => {
  it('覆盖规格的 10 种和弦质量 + 减七（魔方图转调层）+ 2 种六和弦', () => {
    expect(CHORD_QUALITIES.map((q) => q.id)).toEqual([
      'major',
      'minor',
      'diminished',
      'augmented',
      'sus2',
      'sus4',
      'dominant7',
      'major7',
      'minor7',
      'halfDiminished7',
      'diminished7',
      'major6',
      'minor6',
    ])
  })

  it.each(CHORD_QUALITIES)('$id: 字段自洽', (q) => {
    expect(q.symbols.length).toBeGreaterThan(0)
    // 大三和弦的规范符号为空串（省略后缀），其余符号非空
    for (const s of q.symbols) {
      if (q.id === 'major' && s === '') continue
      expect(s.length).toBeGreaterThan(0)
    }
    expect(q.intervals[0]).toBe(0)
    expect([...q.intervals]).toEqual([...q.intervals].sort((a, b) => a - b))
    expect(new Set(q.intervals).size).toBe(q.intervals.length)
    expect(q.intervals.every((i) => i >= 0 && i < 12)).toBe(true)
    expect(q.noteCount).toBe(q.intervals.length)
    expect(q.noteDegrees.length).toBe(q.noteCount)
    expect(q.noteDegrees[0]).toBe('1')
    expect(q.category === 'triad' || q.category === 'seventh').toBe(true)
    expect(q.supportedInversions).toBe(q.noteCount - 1)
  })

  it('三和弦 3 音 2 转位、七和弦 4 音 3 转位', () => {
    for (const q of CHORD_QUALITIES) {
      if (q.category === 'triad') {
        expect(q.noteCount).toBe(3)
        expect(q.supportedInversions).toBe(2)
      } else {
        expect(q.noteCount).toBe(4)
        expect(q.supportedInversions).toBe(3)
      }
    }
  })

  it('MVP 质量的音程与音级名抽查', () => {
    expect(getChordQuality('major').intervals).toEqual([0, 4, 7])
    expect(getChordQuality('minor').intervals).toEqual([0, 3, 7])
    expect(getChordQuality('diminished').intervals).toEqual([0, 3, 6])
    expect(getChordQuality('augmented').intervals).toEqual([0, 4, 8])
    expect(getChordQuality('sus2').intervals).toEqual([0, 2, 7])
    expect(getChordQuality('sus4').intervals).toEqual([0, 5, 7])
    expect(getChordQuality('dominant7').intervals).toEqual([0, 4, 7, 10])
    expect(getChordQuality('major7').intervals).toEqual([0, 4, 7, 11])
    expect(getChordQuality('minor7').intervals).toEqual([0, 3, 7, 10])
    expect(getChordQuality('halfDiminished7').intervals).toEqual([0, 3, 6, 10])
    expect(getChordQuality('diminished7').intervals).toEqual([0, 3, 6, 9])
  })

  it('六和弦：大三/小三 + 大六度，复用七和弦指法类别', () => {
    const major6 = getChordQuality('major6')
    expect(major6.intervals).toEqual([0, 4, 7, 9])
    expect(major6.noteDegrees).toEqual(['1', '3', '5', '6'])
    expect(major6.symbols[0]).toBe('6')
    expect(major6.category).toBe('seventh') // 4 音 3 转位与七和弦同形
    const minor6 = getChordQuality('minor6')
    expect(minor6.intervals).toEqual([0, 3, 7, 9])
    expect(minor6.noteDegrees).toEqual(['1', 'b3', '5', '6'])
    expect(minor6.symbols).toContain('m6')
    expect(minor6.category).toBe('seventh')
  })

  it('getChordQuality：未知 id 抛 RangeError', () => {
    expect(() => getChordQuality('nope')).toThrow(RangeError)
  })

  it('allInversions：枚举 0..supportedInversions', () => {
    expect(allInversions(getChordQuality('major'))).toEqual([0, 1, 2])
    expect(allInversions(getChordQuality('dominant7'))).toEqual([0, 1, 2, 3])
  })
})
