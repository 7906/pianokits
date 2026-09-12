import { describe, expect, it } from 'vitest'

import { ChordParseError, isNoteName, noteNameToPc, parseChordSymbol } from './parse'

describe('parseChordSymbol', () => {
  it('规格 §3 的规范示例逐个解析', () => {
    expect(parseChordSymbol('C')).toEqual({ root: 'C', quality: 'major' })
    expect(parseChordSymbol('Cm')).toEqual({ root: 'C', quality: 'minor' })
    expect(parseChordSymbol('Cdim')).toEqual({ root: 'C', quality: 'diminished' })
    expect(parseChordSymbol('Caug')).toEqual({ root: 'C', quality: 'augmented' })
    expect(parseChordSymbol('C+')).toEqual({ root: 'C', quality: 'augmented' })
    expect(parseChordSymbol('Csus2')).toEqual({ root: 'C', quality: 'sus2' })
    expect(parseChordSymbol('Csus4')).toEqual({ root: 'C', quality: 'sus4' })
    expect(parseChordSymbol('C7')).toEqual({ root: 'C', quality: 'dominant7' })
    expect(parseChordSymbol('Cmaj7')).toEqual({ root: 'C', quality: 'major7' })
    expect(parseChordSymbol('Cm7')).toEqual({ root: 'C', quality: 'minor7' })
    expect(parseChordSymbol('Cm7b5')).toEqual({ root: 'C', quality: 'halfDiminished7' })
    expect(parseChordSymbol('F#m7b5')).toEqual({ root: 'F#', quality: 'halfDiminished7' })
    expect(parseChordSymbol('Bbmaj7')).toEqual({ root: 'Bb', quality: 'major7' })
  })

  it('升降号根音（# / b / ♯ / ♭）', () => {
    expect(parseChordSymbol('F#m')).toEqual({ root: 'F#', quality: 'minor' })
    expect(parseChordSymbol('Bb7')).toEqual({ root: 'Bb', quality: 'dominant7' })
    expect(parseChordSymbol('C♯maj7')).toEqual({ root: 'C#', quality: 'major7' })
    expect(parseChordSymbol('E♭m')).toEqual({ root: 'Eb', quality: 'minor' })
  })

  it('根音字母不区分大小写，空白容忍', () => {
    expect(parseChordSymbol('cm7')).toEqual({ root: 'C', quality: 'minor7' })
    expect(parseChordSymbol('  G7  ')).toEqual({ root: 'G', quality: 'dominant7' })
  })

  it('别名符号（min / - / ° / M7 / sus / min7）', () => {
    expect(parseChordSymbol('Cmin')).toEqual({ root: 'C', quality: 'minor' })
    expect(parseChordSymbol('C-7')).toEqual({ root: 'C', quality: 'minor7' })
    expect(parseChordSymbol('C°')).toEqual({ root: 'C', quality: 'diminished' })
    expect(parseChordSymbol('CM7')).toEqual({ root: 'C', quality: 'major7' })
    expect(parseChordSymbol('Csus')).toEqual({ root: 'C', quality: 'sus4' })
    expect(parseChordSymbol('Cmin7b5')).toEqual({ root: 'C', quality: 'halfDiminished7' })
  })

  it('非法和弦字符串抛 ChordParseError', () => {
    for (const bad of ['', '   ', 'H', '7', 'Cx', 'Cmm', 'Cxyz', 'Csus9', 'Cmaj9', 'Cdim9']) {
      expect(() => parseChordSymbol(bad), bad).toThrow(ChordParseError)
    }
  })

  it('ChordParseError 携带原始输入', () => {
    try {
      parseChordSymbol('Cxyz')
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(ChordParseError)
      expect((e as ChordParseError).symbol).toBe('Cxyz')
    }
  })
})

describe('noteNameToPc / isNoteName', () => {
  it('21 种基础拼写齐全', () => {
    expect(noteNameToPc('C')).toBe(0)
    expect(noteNameToPc('C#')).toBe(1)
    expect(noteNameToPc('Db')).toBe(1)
    expect(noteNameToPc('F#')).toBe(6)
    expect(noteNameToPc('Gb')).toBe(6)
    expect(noteNameToPc('B')).toBe(11)
    expect(noteNameToPc('Cb')).toBe(11)
    expect(noteNameToPc('B#')).toBe(0)
    expect(noteNameToPc('E#')).toBe(5)
    expect(noteNameToPc('Fb')).toBe(4)
  })

  it('非法音名', () => {
    expect(isNoteName('C#')).toBe(true)
    expect(isNoteName('H')).toBe(false)
    expect(isNoteName('c')).toBe(false)
    expect(isNoteName('C##')).toBe(false)
    expect(() => noteNameToPc('H')).toThrow(RangeError)
  })
})
