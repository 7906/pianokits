import { describe, expect, it } from 'vitest'

import { diatonicTriads, getScale, scalePitchClasses, SCALES } from './scales'
import { noteNameToPc } from './parse'

describe('SCALES', () => {
  it('音程自洽：首项 0、升序、11 以内', () => {
    for (const s of SCALES) {
      expect(s.intervals[0]).toBe(0)
      expect([...s.intervals]).toEqual([...s.intervals].sort((a, b) => a - b))
      expect(s.intervals.every((i) => i >= 0 && i <= 11)).toBe(true)
      expect(s.noteCount).toBe(s.intervals.length)
    }
  })

  it('getScale：按 id 取用，未知抛 RangeError', () => {
    expect(getScale('dorian').label).toBe('多利亚')
    expect(() => getScale('nope')).toThrow(RangeError)
  })
})

describe('scalePitchClasses', () => {
  it('C 大调 = 白键集合', () => {
    expect([...scalePitchClasses(0, getScale('major'))].sort((a, b) => a - b)).toEqual([
      0, 2, 4, 5, 7, 9, 11,
    ])
  })

  it('D 自然小调 = D 弗里吉亚? 不——D Aeolian 含 Bb', () => {
    const pcs = scalePitchClasses(noteNameToPc('D'), getScale('naturalMinor'))
    expect(pcs.has(noteNameToPc('Bb'))).toBe(true)
    expect(pcs.has(noteNameToPc('B'))).toBe(false)
  })

  it('五声调式 5 个音级', () => {
    expect(scalePitchClasses(2, getScale('minorPentatonic')).size).toBe(5)
  })
})

describe('diatonicTriads：调内三和弦推导', () => {
  it('C 大调 = C Dm Em F G Am Bdim', () => {
    const t = diatonicTriads(0, getScale('major'))
    expect(t.map((x) => x.symbol)).toEqual(['C', 'Dm', 'Em', 'F', 'G', 'Am', 'Bdim'])
    expect(t[0].degreeIndex).toBe(0)
    expect(t[6].degreeIndex).toBe(6)
  })

  it('D 自然小调 = Dm Edim F Gm Am Bb C（降号拼写）', () => {
    const t = diatonicTriads(noteNameToPc('D'), getScale('naturalMinor'))
    expect(t.map((x) => x.symbol)).toEqual(['Dm', 'Edim', 'F', 'Gm', 'Am', 'Bb', 'C'])
  })

  it('多利亚与混合利底亚的特征和弦', () => {
    // D 多利亚：IV 级为大三（G 大调）——多利亚特征
    const dorian = diatonicTriads(noteNameToPc('D'), getScale('dorian'))
    expect(dorian[3].symbol).toBe('G')
    // G 混合利底亚：bVII 为大三（F 大调）——混合利底亚特征
    const mixo = diatonicTriads(noteNameToPc('G'), getScale('mixolydian'))
    expect(mixo[6].symbol).toBe('F')
  })

  it('五声调式不推导三和弦（返回空）', () => {
    expect(diatonicTriads(0, getScale('minorPentatonic'))).toEqual([])
  })
})
