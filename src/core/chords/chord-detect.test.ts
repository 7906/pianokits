import { describe, expect, it } from 'vitest'

import { getChordNotes } from './notes'
import { CHORD_QUALITIES } from './quality'
import { DETECT_QUALITIES, detectChord, FIFTHS_ORDER } from './chord-detect'

describe('detectChord：转位与排列不影响识别', () => {
  it('C 大三和弦：原位 / 转位 / 八度叠加', () => {
    expect(detectChord([60, 64, 67])).toEqual({ root: 'C', quality: 'major' })
    expect(detectChord([64, 67, 72])).toEqual({ root: 'C', quality: 'major' }) // 第一转位
    expect(detectChord([67, 72, 76])).toEqual({ root: 'C', quality: 'major' }) // 第二转位
    expect(detectChord([48, 60, 64, 67, 76])).toEqual({ root: 'C', quality: 'major' }) // 双手八度叠加
  })

  it('小三与属七（含开放排列、黑键根音）', () => {
    expect(detectChord([57, 60, 64])).toEqual({ root: 'A', quality: 'minor' })
    expect(detectChord([61, 64, 68])).toEqual({ root: 'Db', quality: 'minor' }) // 轮上拼写用 Db
    expect(detectChord([55, 59, 62, 65])).toEqual({ root: 'G', quality: 'dominant7' })
    expect(detectChord([59, 62, 65, 67])).toEqual({ root: 'G', quality: 'dominant7' }) // 第三转位
    expect(detectChord([58, 62, 65, 68])).toEqual({ root: 'Bb', quality: 'dominant7' })
  })

  it('12 根音 × 三类质量 × 随机转位全部识别回自身', () => {
    for (const quality of DETECT_QUALITIES) {
      const q = CHORD_QUALITIES.find((x) => x.id === quality)
      if (q === undefined) throw new Error(`缺少质量 ${quality}`)
      for (const root of FIFTHS_ORDER) {
        for (let inv = 0; inv <= q.supportedInversions; inv++) {
          const { pitches } = getChordNotes(root, quality, inv)
          expect(detectChord(pitches), `${root}${quality} 转位 ${inv}`).toEqual({ root, quality })
        }
      }
    }
  })
})

describe('detectChord：不匹配返回 null', () => {
  it('音数不足（少于 3 个音级）', () => {
    expect(detectChord([])).toBeNull()
    expect(detectChord([60])).toBeNull()
    expect(detectChord([60, 67])).toBeNull() // 纯五度双音
  })

  it('含和弦外音或非三类质量', () => {
    expect(detectChord([60, 64, 67, 71])).toBeNull() // Cmaj7
    expect(detectChord([60, 65, 67])).toBeNull() // Csus4
    expect(detectChord([60, 63, 66])).toBeNull() // Cdim
    expect(detectChord([60, 63, 66, 70])).toBeNull() // Cm7b5
    expect(detectChord([60, 62, 64, 67, 69])).toBeNull() // 5 个不同音级
  })

  it('五度圈顺序正确（12 个根音，相邻纯五度）', () => {
    expect(FIFTHS_ORDER).toHaveLength(12)
    expect(new Set(FIFTHS_ORDER).size).toBe(12)
  })
})
