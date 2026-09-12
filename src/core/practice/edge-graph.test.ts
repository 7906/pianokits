import { describe, expect, it } from 'vitest'

import {
  effectiveWeight,
  getEdge,
  getIncomingEdges,
  getOutgoingEdges,
  indexGraph,
  pickNextEdge,
  weaknessMultiplier,
  type EdgeGraph,
} from './edge-graph'

/** 测试图：a -res(4)-> b, b -res(4)-> a, a -rel(2)-> c, c -mod(1)-> a */
function makeGraph(): EdgeGraph {
  return {
    nodeIds: ['a', 'b', 'c', 'd'],
    edges: [
      { id: 'a->b:resolution', from: 'a', to: 'b', type: 'resolution', weight: 4 },
      { id: 'b->a:resolution', from: 'b', to: 'a', type: 'resolution', weight: 4 },
      { id: 'a->c:relative', from: 'a', to: 'c', type: 'relative', weight: 2 },
      { id: 'c->a:modulation', from: 'c', to: 'a', type: 'modulation', weight: 1 },
    ],
  }
}

describe('getOutgoingEdges / getIncomingEdges', () => {
  it('出边归属正确（from === node）', () => {
    const idx = indexGraph(makeGraph())
    for (const nodeId of ['a', 'b', 'c', 'd']) {
      for (const e of getOutgoingEdges(idx, nodeId)) expect(e.from).toBe(nodeId)
    }
    expect(
      getOutgoingEdges(idx, 'a')
        .map((e) => e.to)
        .sort(),
    ).toEqual(['b', 'c'])
  })

  it('入边归属正确（to === node）；未知节点返回空', () => {
    const idx = indexGraph(makeGraph())
    for (const nodeId of ['a', 'b', 'c', 'd']) {
      for (const e of getIncomingEdges(idx, nodeId)) expect(e.to).toBe(nodeId)
    }
    expect(getIncomingEdges(idx, 'd')).toEqual([])
    expect(getOutgoingEdges(idx, 'x')).toEqual([])
  })
})

describe('getEdge / 稳定 id', () => {
  it('按端点可回查（含类型精确匹配）', () => {
    const idx = indexGraph(makeGraph())
    expect(getEdge(idx, 'a', 'b')?.id).toBe('a->b:resolution')
    expect(getEdge(idx, 'a', 'b', 'resolution')?.weight).toBe(4)
    expect(getEdge(idx, 'a', 'b', 'relative')).toBeNull()
    expect(getEdge(idx, 'a', 'd')).toBeNull()
  })
})

describe('pickNextEdge：只沿出边行进 + 防弹跳 + 回退', () => {
  it('永不出现在无出边的节点上（返回 null）', () => {
    const idx = indexGraph(makeGraph())
    expect(pickNextEdge(idx, 'd')).toBeNull()
  })

  it('avoidNodeId 被严格避让；过滤致空时回退全部出边', () => {
    const idx = indexGraph(makeGraph())
    // a 有两条出边（b、c），避开 b 后必选 c
    for (let i = 0; i < 50; i++) {
      const e = pickNextEdge(idx, 'a', { avoidNodeId: 'b', random: Math.random })
      expect(e?.to).toBe('c')
    }
    // b 只有一条出边回到 a：避开 a 后回退（仍可选 a）——系统始终可运行
    const e = pickNextEdge(idx, 'b', { avoidNodeId: 'a', random: () => 0 })
    expect(e?.to).toBe('a')
  })

  it('A→B→A 不会因回退外的场景出现（b→a 被避让时由回退兜底为唯一合法边）', () => {
    const idx = indexGraph(makeGraph())
    // 无 avoid 时加权选择落在出边集合内
    for (let i = 0; i < 100; i++) {
      const e = pickNextEdge(idx, 'a', { random: Math.random })
      expect(['b', 'c']).toContain(e?.to)
    }
  })
})

describe('加权选择：类型权重与熟练度', () => {
  it('注入随机源可确定性选择（random=0 选累计权重第一的边）', () => {
    const idx = indexGraph(makeGraph())
    const e = pickNextEdge(idx, 'a', { random: () => 0 })
    expect(e?.to).toBe('b') // res(4) 排在 rel(2) 前
  })

  it('薄弱连接有效权重更高（mastery 0.1 ×3，0.9 ×0.5）', () => {
    const idx = indexGraph(makeGraph())
    let weak = 0
    for (let i = 0; i < 400; i++) {
      const e = pickNextEdge(idx, 'a', {
        masteryOf: (id) => (id === 'a->b:resolution' ? 0.9 : 0.1),
        random: Math.random,
      })
      if (e?.to === 'c') weak += 1 // c 是弱边
    }
    // c 基础权重 2×3=6 vs b 4×0.5=2 → c 应占多数
    expect(weak).toBeGreaterThan(240)
  })

  it('熟练边概率降低但不为 0', () => {
    const idx = indexGraph(makeGraph())
    let strong = 0
    for (let i = 0; i < 400; i++) {
      const e = pickNextEdge(idx, 'a', {
        masteryOf: (id) => (id === 'a->b:resolution' ? 0.95 : 0.2),
        random: Math.random,
      })
      if (e?.to === 'b') strong += 1
    }
    expect(strong).toBeGreaterThan(0)
    expect(strong).toBeLessThan(200)
  })

  it('weaknessMultiplier / effectiveWeight 分档', () => {
    expect(weaknessMultiplier(0.1)).toBe(3)
    expect(weaknessMultiplier(0.5)).toBe(2)
    expect(weaknessMultiplier(0.7)).toBe(1)
    expect(weaknessMultiplier(0.9)).toBe(0.5)
    expect(effectiveWeight(4, 0.1)).toBe(12)
    expect(effectiveWeight(4, 0.9)).toBe(2)
  })
})

describe('greedy 策略（Mode B 预测：可学习的确定性路线）', () => {
  const g: EdgeGraph = {
    nodeIds: ['a', 'b', 'c', 'd'],
    edges: [
      { id: 'a->b:resolution', from: 'a', to: 'b', type: 'resolution', weight: 4 },
      { id: 'a->c:relative', from: 'a', to: 'c', type: 'relative', weight: 2 },
      { id: 'a->d:modulation', from: 'a', to: 'd', type: 'modulation', weight: 1 },
    ],
  }

  it('贪心选最高基础权重，忽略 mastery（路线可学习）', () => {
    const idx = indexGraph(g)
    for (let i = 0; i < 50; i++) {
      const e = pickNextEdge(idx, 'a', {
        greedy: true,
        masteryOf: (id) => (id === 'a->b:resolution' ? 0.95 : 0.2), // 不影响
        random: Math.random,
      })
      expect(e?.to).toBe('b')
    }
  })

  it('同权重按目标节点 id 字典序，完全确定', () => {
    const g2: EdgeGraph = {
      nodeIds: ['a', 'z', 'm'],
      edges: [
        { id: 'a->z:x', from: 'a', to: 'z', type: 'x', weight: 4 },
        { id: 'a->m:x', from: 'a', to: 'm', type: 'x', weight: 4 },
      ],
    }
    const idx = indexGraph(g2)
    const e = pickNextEdge(idx, 'a', { greedy: true })
    expect(e?.to).toBe('m')
  })
})
