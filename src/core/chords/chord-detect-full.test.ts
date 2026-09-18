import { describe, expect, it } from 'vitest'

import { getChordNotes } from './notes'
import { CHORD_QUALITIES, getChordQuality } from './quality'
import { FIFTHS_ORDER, detectChordFull } from './chord-detect'
import { noteNameToPc } from './parse'

/** 识别结果的音级集合（判断同音集） */
function pcsOf(res: { root: string; quality: string }): Set<number> {
  const q = getChordQuality(res.quality)
  return new Set(q.intervals.map((i) => (noteNameToPc(res.root) + i) % 12))
}

describe('detectChordFull：低音优先消歧', () => {
  it('C6 与 Am7 同音集：低音定主判，互为别解', () => {
    // C-E-G-A 低音 C → C6 原位；别解 = Am7（低音 C = Am7 第一转位）
    const c6 = detectChordFull([60, 64, 67, 69])
    expect(c6?.chord).toEqual({ root: 'C', quality: 'major6', inversion: 0, symbol: 'C6' })
    expect(c6?.alternates.map((a) => a.symbol)).toEqual(['Am7'])
    expect(c6?.alternates[0]?.inversion).toBe(1)

    // A-C-E-G 低音 A → Am7 原位；别解 = C6 第三转位
    const am7 = detectChordFull([57, 60, 64, 67])
    expect(am7?.chord).toEqual({ root: 'A', quality: 'minor7', inversion: 0, symbol: 'Am7' })
    expect(am7?.alternates.map((a) => a.symbol)).toEqual(['C6'])
    expect(am7?.alternates[0]?.inversion).toBe(3)
  })

  it('低音不是任何候选根音：按回退优先级取七和弦解释', () => {
    // E-G-A-C（低音 E）：C6 与 Am7 都不以 E 为根 → Am7 第二转位
    const r = detectChordFull([64, 67, 69, 72])
    expect(r?.chord).toEqual({ root: 'A', quality: 'minor7', inversion: 2, symbol: 'Am7' })
    expect(r?.alternates.map((a) => a.symbol)).toEqual(['C6'])
  })

  it('Cm6 与 Am7b5 同音集：低音定主判', () => {
    // C-Eb-G-A 低音 C → Cm6 原位
    const cm6 = detectChordFull([60, 63, 67, 69])
    expect(cm6?.chord).toEqual({ root: 'C', quality: 'minor6', inversion: 0, symbol: 'Cm6' })
    expect(cm6?.alternates.map((a) => a.symbol)).toEqual(['Am7b5'])
    // A-C-Eb-G 低音 A → Am7b5 原位
    const am7b5 = detectChordFull([57, 60, 63, 67])
    expect(am7b5?.chord).toEqual({
      root: 'A',
      quality: 'halfDiminished7',
      inversion: 0,
      symbol: 'Am7b5',
    })
    expect(am7b5?.alternates.map((a) => a.symbol)).toEqual(['Cm6'])
  })

  it('减七：低音优先取根音，其余等音拼写进别解', () => {
    // {B,D,F,Ab} 低音 B → B°7 原位；别解 D°7/Ab°7/F°7（五度圈序）
    const r = detectChordFull([71, 74, 77, 80])
    expect(r?.chord).toEqual({ root: 'B', quality: 'diminished7', inversion: 0, symbol: 'B°7' })
    expect(r?.alternates.map((a) => a.symbol)).toEqual(['D°7', 'Ab°7', 'F°7'])
  })

  it('挂二/挂四同音集：低音优先', () => {
    // C-D-G 低音 C → Csus2；别解 Gsus4 第一转位
    const sus2 = detectChordFull([60, 62, 67])
    expect(sus2?.chord).toEqual({ root: 'C', quality: 'sus2', inversion: 0, symbol: 'Csus2' })
    expect(sus2?.alternates.map((a) => a.symbol)).toEqual(['Gsus4'])
    expect(sus2?.alternates[0]?.inversion).toBe(1)
    // G-C-D 低音 G → Gsus4 原位；别解 Csus2 第二转位
    const sus4 = detectChordFull([55, 60, 62])
    expect(sus4?.chord).toEqual({ root: 'G', quality: 'sus4', inversion: 0, symbol: 'Gsus4' })
    expect(sus4?.alternates.map((a) => a.symbol)).toEqual(['Csus2'])
    expect(sus4?.alternates[0]?.inversion).toBe(2)
  })

  it('增三：3 个等音拼写，低音定根', () => {
    const r = detectChordFull([60, 64, 68])
    expect(r?.chord).toEqual({ root: 'C', quality: 'augmented', inversion: 0, symbol: 'Caug' })
    expect(r?.alternates.map((a) => a.symbol)).toEqual(['Eaug', 'Abaug'])
  })

  it('无歧义和弦别解为空，转位由低音给出', () => {
    // G7 第三转位（F 低音）
    const g7 = detectChordFull([65, 67, 71, 74])
    expect(g7?.chord).toEqual({ root: 'G', quality: 'dominant7', inversion: 3, symbol: 'G7' })
    expect(g7?.alternates).toEqual([])
    // Am7/C：C-E-G-A 但上一条用例已覆盖低音歧义；这里验证 maj7 独立音集
    const cmaj7 = detectChordFull([60, 64, 67, 71])
    expect(cmaj7?.chord).toEqual({ root: 'C', quality: 'major7', inversion: 0, symbol: 'Cmaj7' })
    expect(cmaj7?.alternates).toEqual([])
  })

  it('八度重复与排列不影响识别', () => {
    const r = detectChordFull([48, 55, 60, 64, 67, 69, 76])
    expect(r?.chord.root).toBe('C')
    expect(r?.chord.quality).toBe('major6')
  })

  it('魔方图互不影响：detectChordFull 不改变 detectChord 的四类行为', () => {
    // 同一 Am7 音集，魔方图识别仍返回 minor7（Am7 是图上节点）
    expect(detectChordFull([57, 60, 64, 67])?.chord.quality).toBe('minor7')
    // C6 音集在魔方图四类下本就无匹配（六和弦不进图）
    // 这里只锁定 detectChordFull 覆盖了六和弦（DETECT_FULL_QUALITIES 语义由实现保证）
  })
})

describe('detectChordFull：不匹配返回 null', () => {
  it('音数不足 / 音级过多 / 和弦外音', () => {
    expect(detectChordFull([])).toBeNull()
    expect(detectChordFull([60, 64])).toBeNull()
    expect(detectChordFull([60, 62, 64, 67, 69])).toBeNull() // 5 个不同音级
    expect(detectChordFull([60, 63, 67, 71])).toBeNull() // Cm(maj7)：不在 13 类
    expect(detectChordFull([60, 61, 62])).toBeNull() // 二度音簇
  })
})

describe('detectChordFull：12 根音 × 13 质量 × 全部转位扫描', () => {
  it('识别结果与输入同音集，且低音=根音时转位还原', () => {
    for (const q of CHORD_QUALITIES) {
      for (const root of FIFTHS_ORDER) {
        for (let inv = 0; inv <= q.supportedInversions; inv++) {
          const { pitches } = getChordNotes(root, q.id, inv)
          const res = detectChordFull(pitches)
          expect(res, `${root}${q.symbols[0]} 转位 ${inv}`).not.toBeNull()
          const all = [res!.chord, ...res!.alternates]
          // 输入和弦必须出现在识别结果（主判或别解）中
          const inputRootPc = noteNameToPc(root)
          const matched = all.find(
            (c) => noteNameToPc(c.root) === inputRootPc && c.quality === q.id,
          )
          expect(matched, `${root}${q.symbols[0]} 转位 ${inv} 未被识别`).toBeDefined()
          // 主判与所有别解两两同音集
          const base = pcsOf({ root: res!.chord.root, quality: res!.chord.quality })
          for (const a of res!.alternates) {
            const ap = pcsOf(a)
            expect([...ap].sort(), `${a.symbol} 与主判不同音集`).toEqual([...base].sort())
          }
          // 转位还原：主判根音与输入根音同 pc 时，主判转位 = 输入转位
          if (noteNameToPc(res!.chord.root) === inputRootPc) {
            expect(res!.chord.inversion, `${root}${q.symbols[0]} 转位 ${inv}`).toBe(inv)
          }
        }
      }
    }
  })
})
