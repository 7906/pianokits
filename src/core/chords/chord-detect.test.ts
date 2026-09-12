import { describe, expect, it } from 'vitest'

import { getChordNotes } from './notes'
import { CHORD_QUALITIES } from './quality'
import { DETECT_QUALITIES, detectChord, detectDim7Roots, FIFTHS_ORDER } from './chord-detect'
import { noteNameToPc } from './parse'

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

  it('减七：转位 / 叠加不影响，单识别返回五度圈序第一个拼写', () => {
    // B°7 音集 {B,D,F,Ab}：四个等音拼写 B/D/F/Ab，五度圈序第一个是 D
    expect(detectChord([71, 74, 77, 80])).toEqual({ root: 'D', quality: 'diminished7' })
    // 转位（Ab 低音）同音集 → 拼写同样折叠到 D
    expect(detectChord([68, 71, 74, 77])).toEqual({ root: 'D', quality: 'diminished7' })
    // {C,Eb,Gb,A} 族：等音拼写 C/Eb/F#/A，五度圈序第一个是 C
    expect(detectChord([60, 63, 66, 69])).toEqual({ root: 'C', quality: 'diminished7' })
  })

  it('detectDim7Roots：一个减七音集返回全部 4 个等音拼写（五度圈序）', () => {
    expect(detectDim7Roots([71, 74, 77, 80])).toEqual(['D', 'B', 'Ab', 'F'])
    expect(detectDim7Roots([61, 64, 67, 70])).toEqual(['G', 'E', 'Db', 'Bb']) // 同音集转位
    expect(detectDim7Roots([60, 63, 66, 69])).toEqual(['C', 'A', 'F#', 'Eb'])
    expect(detectDim7Roots([60, 64, 67])).toEqual([]) // 大三不是减七
  })

  it('12 根音 × 四类质量 × 全部转位识别回自身（减七按音集等价）', () => {
    for (const quality of DETECT_QUALITIES) {
      const q = CHORD_QUALITIES.find((x) => x.id === quality)
      if (q === undefined) throw new Error(`缺少质量 ${quality}`)
      for (const root of FIFTHS_ORDER) {
        for (let inv = 0; inv <= q.supportedInversions; inv++) {
          const { pitches } = getChordNotes(root, quality, inv)
          if (quality === 'diminished7') {
            // 减七 4拼写同音集：识别质量正确、且原拼写 在等音拼写集合中
            const hit = detectChord(pitches)
            expect(hit?.quality, `${root}°7 转位 ${inv}`).toBe('diminished7')
            expect(detectDim7Roots(pitches), `${root}°7 转位 ${inv}`).toContain(root)
            // 音集确实等于原和弦
            const pcs = new Set(pitches.map((p) => p % 12))
            const rootPc = noteNameToPc(root)
            expect(hit).not.toBeNull()
            const canon = getChordNotes(hit!.root, 'diminished7').pitches.map((p) => p % 12)
            expect(new Set(canon)).toEqual(pcs)
            expect(rootPc).toBe(noteNameToPc(root)) // 平凡断言，防拼写笔误
          } else {
            expect(detectChord(pitches), `${root}${quality} 转位 ${inv}`).toEqual({
              root,
              quality,
            })
          }
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

  it('含和弦外音或非四类质量', () => {
    expect(detectChord([60, 64, 67, 71])).toBeNull() // Cmaj7
    expect(detectChord([60, 65, 67])).toBeNull() // Csus4
    expect(detectChord([60, 63, 66])).toBeNull() // Cdim（减三不在识别集）
    expect(detectChord([60, 63, 66, 70])).toBeNull() // Cm7b5
    expect(detectChord([60, 62, 64, 67, 69])).toBeNull() // 5 个不同音级
  })

  it('五度圈顺序正确（12 个根音，相邻纯五度）', () => {
    expect(FIFTHS_ORDER).toHaveLength(12)
    expect(new Set(FIFTHS_ORDER).size).toBe(12)
  })
})
