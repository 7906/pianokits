import { describe, expect, it, vi } from 'vitest'

import { ChordPracticeEngine } from './chord-practice'

describe('ChordPracticeEngine', () => {
  it('出题后：目标内按键不算错，目标外按键标错', () => {
    const e = new ChordPracticeEngine()
    e.setQuestion([60, 64, 67])
    e.setHeld([60])
    expect(e.state.wrong).toEqual(new Set())
    expect(e.state.solved).toBe(false)
    e.setHeld([60, 70])
    expect(e.state.wrong).toEqual(new Set([70]))
    expect(e.state.solved).toBe(false)
  })

  it('按住集合与目标完全一致时解答成立', () => {
    const e = new ChordPracticeEngine()
    e.setQuestion([60, 64, 67])
    e.setHeld([60, 64])
    expect(e.state.solved).toBe(false)
    e.setHeld([64, 67, 60])
    expect(e.state.solved).toBe(true)
  })

  it('多按一个键不成立（必须不多不少）', () => {
    const e = new ChordPracticeEngine()
    e.setQuestion([60, 64, 67])
    e.setHeld([60, 64, 67, 72])
    expect(e.state.solved).toBe(false)
    expect(e.state.wrong).toEqual(new Set([72]))
  })

  it('onSolved 边沿触发一次：持续按住不重复，松开后重弹再触发', () => {
    const e = new ChordPracticeEngine()
    const cb = vi.fn()
    e.onSolved(cb)
    e.setQuestion([60, 64])
    e.setHeld([60, 64])
    expect(cb).toHaveBeenCalledTimes(1)
    e.setHeld([60, 64])
    expect(cb).toHaveBeenCalledTimes(1)
    e.setHeld([])
    expect(e.state.solved).toBe(false)
    e.setHeld([60, 64])
    expect(cb).toHaveBeenCalledTimes(2)
  })

  it('换题后重置判定状态；空集合取消题目', () => {
    const e = new ChordPracticeEngine()
    e.setQuestion([60, 64])
    e.setHeld([60, 70])
    e.setQuestion([62, 65, 69])
    expect(e.state.wrong).toEqual(new Set())
    expect(e.state.solved).toBe(false)
    e.setQuestion([])
    expect(e.state.target).toBeNull()
    // 无题目时按键不判错、不解答
    e.setHeld([60, 64])
    expect(e.state.wrong).toEqual(new Set())
    expect(e.state.solved).toBe(false)
  })

  it('releaseAll / reset', () => {
    const e = new ChordPracticeEngine()
    e.setQuestion([60])
    e.setHeld([60, 61])
    e.releaseAll()
    expect(e.state.held.size).toBe(0)
    expect(e.state.solved).toBe(false)
    e.reset()
    expect(e.state.target).toBeNull()
  })

  it('onSolved 返回取消订阅函数', () => {
    const e = new ChordPracticeEngine()
    const cb = vi.fn()
    const off = e.onSolved(cb)
    off()
    e.setQuestion([60])
    e.setHeld([60])
    expect(cb).not.toHaveBeenCalled()
  })

  it('state 返回快照（外部修改不影响引擎内部）', () => {
    const e = new ChordPracticeEngine()
    e.setQuestion([60, 64])
    const s = e.state
    ;(s.held as Set<number>).add(60)
    ;(s.target as Set<number>).delete(64)
    expect(e.state.held.size).toBe(0)
    expect(e.state.target).toEqual(new Set([60, 64]))
  })
})
