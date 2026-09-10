import { describe, expect, it } from 'vitest'

import { CHORD_QUALITIES, allInversions } from '../chords/quality'
import { getChordNotes } from '../chords/notes'
import { getChordFingering } from './engine'
import { SMALL_HAND_PROFILE, STANDARD_PROFILE, createCustomProfile, overrideKey } from './profile'
import { SEVENTH_PATTERNS, TRIAD_PATTERNS } from './patterns'

const ROOTS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const
const HANDS = ['right', 'left'] as const

describe('模式表（规格 §6/§7）', () => {
  it('右手七和弦参考模式与规格逐项一致', () => {
    expect(SEVENTH_PATTERNS.right).toEqual([
      [1, 2, 3, 5], // 原位
      [1, 2, 4, 5], // 第一转位
      [1, 2, 3, 5], // 第二转位
      [1, 2, 3, 4], // 第三转位
    ])
  })

  it('三和弦标准模式：右手原位 1-3-5、左手原位 5-3-1', () => {
    expect(TRIAD_PATTERNS.right[0]).toEqual([1, 3, 5])
    expect(TRIAD_PATTERNS.left[0]).toEqual([5, 3, 1])
  })
})

describe('getChordFingering：12 根音 × 全部质量 × 全部转位 × 左右手', () => {
  for (const quality of CHORD_QUALITIES) {
    for (const inversion of allInversions(quality)) {
      for (const hand of HANDS) {
        it.each(ROOTS)(
          `${hand[0].toUpperCase()}H %s${quality.symbols[0]} 转位 ${inversion}`,
          (root) => {
            const notes = getChordNotes(root, quality, inversion)
            const f = getChordFingering({ root, quality: quality.id, inversion, hand })
            // 指法数量与音符数量一致
            expect(f.fingers.length).toBe(notes.pitches.length)
            // 手指编号均在 1–5
            expect(f.fingers.every((x) => Number.isInteger(x) && x >= 1 && x <= 5)).toBe(true)
            expect(f.source).toBe('pattern')
            expect(f.quality).toBe(quality.id)
            expect(f.hand).toBe(hand)
            expect(f.inversion).toBe(inversion)
          },
        )
      }
    }
  }

  it('standard profile：右手三和弦规则（原位/一转 1-3-5，二转 1-2-5）', () => {
    expect(
      getChordFingering({ root: 'C', quality: 'major', inversion: 0, hand: 'right' }).fingers,
    ).toEqual([1, 3, 5])
    expect(
      getChordFingering({ root: 'C', quality: 'major', inversion: 1, hand: 'right' }).fingers,
    ).toEqual([1, 3, 5])
    expect(
      getChordFingering({ root: 'C', quality: 'major', inversion: 2, hand: 'right' }).fingers,
    ).toEqual([1, 2, 5])
  })

  it('standard profile：左手三和弦从 5 指开始、1 指结束', () => {
    for (const quality of CHORD_QUALITIES.filter((q) => q.category === 'triad')) {
      for (const inversion of allInversions(quality)) {
        const f = getChordFingering({ root: 'Eb', quality: quality.id, inversion, hand: 'left' })
        expect(f.fingers[0]).toBe(5)
        expect(f.fingers[f.fingers.length - 1]).toBe(1)
      }
    }
  })

  it('standard profile：右手七和弦低音恒为 1 指（各转位独立规则）', () => {
    for (const quality of CHORD_QUALITIES.filter((q) => q.category === 'seventh')) {
      for (const inversion of allInversions(quality)) {
        const f = getChordFingering({ root: 'Bb', quality: quality.id, inversion, hand: 'right' })
        expect(f.fingers[0]).toBe(1)
      }
    }
  })

  it('左右手规则不镜像（左手七和弦以 5 指起）', () => {
    for (const inversion of [0, 1, 2, 3]) {
      const rh = getChordFingering({ root: 'C', quality: 'dominant7', inversion, hand: 'right' })
      const lh = getChordFingering({ root: 'C', quality: 'dominant7', inversion, hand: 'left' })
      expect(lh.fingers[0]).toBe(5)
      expect(rh.fingers[0]).toBe(1)
      expect(lh.fingers).not.toEqual(rh.fingers)
    }
  })
})

describe('profile', () => {
  it('small-hand：三和弦中段 3 → 2（1-3-5 变 1-2-5）', () => {
    const f = getChordFingering({
      root: 'C',
      quality: 'major',
      inversion: 0,
      hand: 'right',
      profile: 'small-hand',
    })
    expect(f.fingers).toEqual([1, 2, 5])
    // 左手同样放宽：5-3-1 → 5-2-1
    const lh = getChordFingering({
      root: 'C',
      quality: 'major',
      inversion: 0,
      hand: 'left',
      profile: SMALL_HAND_PROFILE,
    })
    expect(lh.fingers).toEqual([5, 2, 1])
  })

  it('small-hand：已是 1-2-5 的第二转位不变，七和弦保持标准表', () => {
    expect(
      getChordFingering({
        root: 'C',
        quality: 'major',
        inversion: 2,
        hand: 'right',
        profile: 'small-hand',
      }).fingers,
    ).toEqual([1, 2, 5])
    expect(
      getChordFingering({
        root: 'C',
        quality: 'dominant7',
        inversion: 0,
        hand: 'right',
        profile: 'small-hand',
      }).fingers,
    ).toEqual([1, 2, 3, 5])
    expect(
      getChordFingering({
        root: 'C',
        quality: 'dominant7',
        inversion: 3,
        hand: 'right',
        profile: 'small-hand',
      }).fingers,
    ).toEqual([1, 2, 3, 4])
  })

  it('small-hand 覆盖 12 根音 × 全部质量 × 转位 × 左右手（形状合法）', () => {
    for (const quality of CHORD_QUALITIES) {
      for (const inversion of allInversions(quality)) {
        for (const hand of HANDS) {
          const f = getChordFingering({
            root: 'F#',
            quality: quality.id,
            inversion,
            hand,
            profile: 'small-hand',
          })
          expect(f.fingers.length).toBe(quality.noteCount)
          expect(f.fingers.every((x) => x >= 1 && x <= 5)).toBe(true)
        }
      }
    }
  })

  it('custom：例外覆盖指定和弦（其余回落 standard）', () => {
    const custom = createCustomProfile([[overrideKey('major', 'right', 0), [1, 4, 5]]])
    expect(
      getChordFingering({
        root: 'C',
        quality: 'major',
        inversion: 0,
        hand: 'right',
        profile: custom,
      }),
    ).toEqual(expect.objectContaining({ fingers: [1, 4, 5], source: 'override' }))
    expect(
      getChordFingering({
        root: 'C',
        quality: 'minor',
        inversion: 0,
        hand: 'right',
        profile: custom,
      }).fingers,
    ).toEqual([1, 3, 5])
    expect(
      getChordFingering({
        root: 'D',
        quality: 'major',
        inversion: 1,
        hand: 'right',
        profile: custom,
      }).fingers,
    ).toEqual([1, 3, 5])
  })

  it('调用方临时覆盖优先于 profile 内置覆盖', () => {
    const profile = createCustomProfile([[overrideKey('major', 'right', 0), [1, 4, 5]]])
    const f = getChordFingering({
      root: 'C',
      quality: 'major',
      inversion: 0,
      hand: 'right',
      profile,
      overrides: [[overrideKey('major', 'right', 0), [2, 4, 5]]],
    })
    expect(f.fingers).toEqual([2, 4, 5])
  })

  it('standard profile 对象直传与 id 等价', () => {
    const a = getChordFingering({
      root: 'C',
      quality: 'major7',
      inversion: 1,
      hand: 'right',
      profile: 'standard',
    })
    const b = getChordFingering({
      root: 'C',
      quality: 'major7',
      inversion: 1,
      hand: 'right',
      profile: STANDARD_PROFILE,
    })
    expect(a.fingers).toEqual(b.fingers)
  })

  it('非法手指序列的覆盖抛 RangeError', () => {
    expect(() => createCustomProfile([[overrideKey('major', 'right', 0), [1, 9, 5]]])).toThrow(
      RangeError,
    )
    expect(() => createCustomProfile([[overrideKey('major', 'right', 0), [1, 0, 5]]])).toThrow(
      RangeError,
    )
    expect(() =>
      getChordFingering({
        root: 'C',
        quality: 'major',
        inversion: 0,
        hand: 'right',
        overrides: [[overrideKey('major', 'right', 0), [1]]],
      }),
    ).toThrow(RangeError)
  })

  it('未知 profile id 抛 RangeError', () => {
    expect(() =>
      getChordFingering({
        root: 'C',
        quality: 'major',
        inversion: 0,
        hand: 'right',
        profile: 'nope',
      }),
    ).toThrow(RangeError)
  })
})

describe('getChordFingering：非法输入', () => {
  it('非法手别抛 RangeError', () => {
    expect(() =>
      getChordFingering({ root: 'C', quality: 'major', inversion: 0, hand: 'both' as never }),
    ).toThrow(RangeError)
  })

  it('未知质量抛 RangeError', () => {
    expect(() =>
      getChordFingering({ root: 'C', quality: 'nope' as never, inversion: 0, hand: 'right' }),
    ).toThrow(RangeError)
  })

  it('非法转位抛 RangeError（三和弦无第三转位）', () => {
    expect(() =>
      getChordFingering({ root: 'C', quality: 'major', inversion: 3, hand: 'right' }),
    ).toThrow(RangeError)
    expect(() =>
      getChordFingering({ root: 'C', quality: 'major', inversion: -1, hand: 'right' }),
    ).toThrow(RangeError)
    // 七和弦第三转位必须显式可用（规格 §7）
    expect(
      getChordFingering({ root: 'C', quality: 'dominant7', inversion: 3, hand: 'right' }).fingers,
    ).toEqual([1, 2, 3, 4])
  })
})
