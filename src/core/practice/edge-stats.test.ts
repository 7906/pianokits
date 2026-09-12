import { describe, expect, it } from 'vitest'

import {
  computeMastery,
  EDGE_STATS_STORAGE_KEY,
  EdgeStatsStore,
  emptyEdgeStats,
  speedScore,
  type KeyValueStorage,
} from './edge-stats'

/** 内存存储（localStorage 形状），可预置损坏数据 */
function makeStorage(initial?: Record<string, string>): {
  storage: KeyValueStorage
  dump: () => Record<string, string>
} {
  const map = new Map<string, string>(Object.entries(initial ?? {}))
  return {
    storage: {
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => void map.set(k, v),
    },
    dump: () => Object.fromEntries(map),
  }
}

describe('recordResult：成功 / 失败记账', () => {
  it('成功：attempts/successes/consecutive 累计，时长只从成功累计', () => {
    const store = new EdgeStatsStore(null)
    store.recordResult('e1', { success: true, responseTimeMs: 1200, now: 100 })
    store.recordResult('e1', { success: true, responseTimeMs: 2400, now: 200 })
    const s = store.get('e1')
    expect(s).toEqual({
      attempts: 2,
      successes: 2,
      failures: 0,
      consecutiveSuccesses: 2,
      totalResponseTimeMs: 3600,
      lastPracticedAt: 200,
    })
  })

  it('失败：failures 计入、连对清零、时长不变；responseTimeMs 被忽略', () => {
    const store = new EdgeStatsStore(null)
    store.recordResult('e1', { success: true, responseTimeMs: 1000, now: 1 })
    store.recordResult('e1', { success: false, responseTimeMs: 99999, now: 2 })
    const s = store.get('e1')
    expect(s.attempts).toBe(2)
    expect(s.successes).toBe(1)
    expect(s.failures).toBe(1)
    expect(s.consecutiveSuccesses).toBe(0)
    expect(s.totalResponseTimeMs).toBe(1000)
  })

  it('未练过的边返回空统计', () => {
    const store = new EdgeStatsStore(null)
    expect(store.get('nope')).toEqual(emptyEdgeStats())
  })
})

describe('mastery：简单可解释', () => {
  it('未练过 = 0.5（中性，鼓励探索）', () => {
    expect(computeMastery(emptyEdgeStats())).toBe(0.5)
    expect(new EdgeStatsStore(null).mastery('x')).toBe(0.5)
  })

  it('速度分：1s 内满分，3s 一半，5s 起 0 分', () => {
    expect(speedScore(800)).toBe(1)
    expect(speedScore(3000)).toBeCloseTo(0.5)
    expect(speedScore(6000)).toBe(0)
  })

  it('全对且快 → 高熟练；常错且慢 → 低熟练', () => {
    const fast = emptyEdgeStats()
    fast.attempts = 10
    fast.successes = 10
    fast.totalResponseTimeMs = 10_000 // 平均 1s
    expect(computeMastery(fast)).toBeGreaterThan(0.9)

    const slow = emptyEdgeStats()
    slow.attempts = 10
    slow.successes = 2
    slow.totalResponseTimeMs = 40_000 // 平均 20s
    expect(computeMastery(slow)).toBeLessThan(0.2)
  })

  it('拉普拉斯平滑：单次成功不满 1、单次失败不至 0', () => {
    const one = emptyEdgeStats()
    one.attempts = 1
    one.successes = 1
    one.totalResponseTimeMs = 1000
    expect(computeMastery(one)).toBeLessThan(1)
    const bad = emptyEdgeStats()
    bad.attempts = 1
    bad.failures = 1
    expect(computeMastery(bad)).toBeGreaterThan(0)
  })

  it('store.mastery 与 computeMastery 一致', () => {
    const store = new EdgeStatsStore(null)
    store.recordResult('e1', { success: true, responseTimeMs: 1000, now: 1 })
    const s = store.get('e1')
    expect(store.mastery('e1')).toBe(computeMastery(s))
  })
})

describe('localStorage 持久化与损坏回退', () => {
  it('记录后写入存储；新实例同 key 读回（刷新保留）', () => {
    const { storage, dump } = makeStorage()
    const a = new EdgeStatsStore(storage)
    a.recordResult('C/major->G/dominant7:cycle', { success: true, responseTimeMs: 1500, now: 7 })
    expect(Object.keys(dump())).toContain(EDGE_STATS_STORAGE_KEY)
    const b = new EdgeStatsStore(storage)
    expect(b.get('C/major->G/dominant7:cycle').attempts).toBe(1)
    expect(b.mastery('C/major->G/dominant7:cycle')).toBeGreaterThan(0.5)
  })

  it('损坏 JSON / 错误形状 / 错版本 → 安全回退空状态', () => {
    for (const bad of [
      '{oops',
      'null',
      '{"version":2,"edges":{}}',
      '{"version":1,"edges":{"e":{"attempts":"x"}}}',
    ]) {
      const { storage } = makeStorage({ [EDGE_STATS_STORAGE_KEY]: bad })
      const store = new EdgeStatsStore(storage)
      expect(store.size).toBe(0)
      expect(store.get('e')).toEqual(emptyEdgeStats())
    }
  })

  it('无存储（null）可正常运行（隐私模式兜底）', () => {
    const store = new EdgeStatsStore(null)
    store.recordResult('e', { success: true, responseTimeMs: 900 })
    expect(store.get('e').attempts).toBe(1)
  })

  it('存储写入抛错不影响内存态练习', () => {
    const throwing: KeyValueStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota')
      },
    }
    const store = new EdgeStatsStore(throwing)
    expect(() => store.recordResult('e', { success: true })).not.toThrow()
    expect(store.get('e').attempts).toBe(1)
  })
})

describe('weakest：薄弱连接清单', () => {
  it('只含有记录的边，按 mastery 升序取前 N', () => {
    const store = new EdgeStatsStore(null)
    // e-good：全对且快；e-bad：多错且慢；e-mid：一半
    for (let i = 0; i < 5; i++)
      store.recordResult('e-good', { success: true, responseTimeMs: 1000, now: i })
    for (let i = 0; i < 5; i++)
      store.recordResult('e-bad', { success: i < 1, responseTimeMs: 5000, now: i })
    store.recordResult('e-mid', { success: true, responseTimeMs: 2000, now: 1 })
    store.recordResult('e-mid', { success: false, now: 2 })
    const list = store.weakest(2)
    expect(list.map((w) => w.edgeId)).toEqual(['e-bad', 'e-mid'])
    expect(list[0].mastery).toBeLessThan(list[1].mastery)
  })
})
