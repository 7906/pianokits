import { describe, expect, it } from 'vitest'

import { buildFigure, randomNeighborChord } from './harmony-graph'

describe('randomNeighborChord：行进严格沿图上走线', () => {
  it('转调图：C 大三的邻居只落在走线相连的和弦上', () => {
    const figure = buildFigure('functional')
    const got = new Set<string>()
    for (let i = 0; i < 300; i++) {
      const n = randomNeighborChord(figure, { root: 'C', quality: 'major' })
      expect(n).not.toBeNull()
      got.add(`${n!.root}/${n!.quality}`)
    }
    // 关系小三、属七（来自 G7 的解决线）、家族含 C 的四个减七
    expect(got).toEqual(
      new Set([
        'A/minor',
        'G/dominant7',
        'B/diminished7',
        'Ab/diminished7',
        'F/diminished7',
        'D/diminished7',
      ]),
    )
  })

  it('走线图：外环行进走 V7 链（C 的邻居是两侧属七），锚点不参与', () => {
    const figure = buildFigure('voiceleading')
    const got = new Set<string>()
    for (let i = 0; i < 300; i++) {
      const n = randomNeighborChord(figure, { root: 'C', quality: 'major' })
      expect(n).not.toBeNull()
      got.add(`${n!.root}/${n!.quality}`)
    }
    expect(got).toEqual(new Set(['C/dominant7', 'G/dominant7']))
  })

  it('avoidId 被严格避让（防来回弹跳）', () => {
    const vl = buildFigure('voiceleading')
    for (let i = 0; i < 100; i++) {
      const n = randomNeighborChord(vl, { root: 'C', quality: 'major' }, 'G/dominant7')
      expect(`${n!.root}/${n!.quality}`).toBe('C/dominant7')
    }
    for (let i = 0; i < 100; i++) {
      const n = randomNeighborChord(vl, { root: 'C', quality: 'major' }, 'C/dominant7')
      expect(`${n!.root}/${n!.quality}`).toBe('G/dominant7')
    }
  })
})
