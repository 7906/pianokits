import { describe, expect, it } from 'vitest'

import {
  buildFigure,
  chordByNode,
  EDGE_TYPE_BY_KIND,
  EDGE_WEIGHT_BY_KIND,
  toEdgeGraph,
} from './harmony-graph'
import {
  edgeId,
  getEdge,
  getIncomingEdges,
  getOutgoingEdges,
  indexGraph,
} from '../../core/practice/edge-graph'

describe('toEdgeGraph：figure → 有向语义图（单一真相的投影）', () => {
  const functional = buildFigure('functional')
  const voiceleading = buildFigure('voiceleading')

  it('节点 = 全部可点选和弦（转调图 4 族×12=48，走线图 3 族×12=36），锚点不进入语义图', () => {
    const gf = toEdgeGraph(functional)
    const gv = toEdgeGraph(voiceleading)
    expect(gf.nodeIds.length).toBe(48)
    expect(gv.nodeIds.length).toBe(36)
    for (const ids of [gf.nodeIds, gv.nodeIds]) {
      expect(ids.every((id) => !id.startsWith('bass:'))).toBe(true)
    }
    const bassCount = voiceleading.nodes.filter((n) => n.pick === undefined).length
    expect(bassCount).toBe(24)
  })

  it('每条语义边 id 稳定：`${from}->${to}:${type}`，且 from/to 均为和弦节点', () => {
    for (const figure of [functional, voiceleading]) {
      const g = toEdgeGraph(figure)
      const nodeIds = new Set(g.nodeIds)
      for (const e of g.edges) {
        expect(e.id).toBe(`${e.from}->${e.to}:${e.type}`)
        expect(nodeIds.has(e.from)).toBe(true)
        expect(nodeIds.has(e.to)).toBe(true)
      }
    }
  })

  it('双向箭头拆成两条有向边：走线图 C ↔ G7', () => {
    const g = toEdgeGraph(voiceleading)
    expect(getEdge(indexGraph(g), 'C/major', 'G/dominant7', 'cycle')).not.toBeNull()
    expect(getEdge(indexGraph(g), 'G/dominant7', 'C/major', 'cycle')).not.toBeNull()
  })

  it('类型与权重映射：resolution 4 / cycle 3 / relative 2 / modulation 1', () => {
    expect(EDGE_TYPE_BY_KIND.res).toBe('resolution')
    expect(EDGE_TYPE_BY_KIND.ring).toBe('cycle')
    expect(EDGE_TYPE_BY_KIND.rel).toBe('relative')
    expect(EDGE_TYPE_BY_KIND.dim).toBe('modulation')
    expect(EDGE_WEIGHT_BY_KIND.res).toBe(4)
    expect(EDGE_WEIGHT_BY_KIND.ring).toBe(3)
    expect(EDGE_WEIGHT_BY_KIND.rel).toBe(2)
    expect(EDGE_WEIGHT_BY_KIND.dim).toBe(1)
  })

  it('转调图：G7 的出边 = 解决到大/小三（resolution 正向）', () => {
    const g = toEdgeGraph(functional)
    const idx = indexGraph(g)
    const outs = getOutgoingEdges(idx, 'G/dominant7').map((e) => `${e.to}:${e.type}`)
    expect(outs).toEqual(['C/major:resolution', 'C/minor:resolution'])
  })

  it('双向训练边：大三的出边含逆行走线（去属七 / 去减七枢纽）——独立训练对象', () => {
    const g = toEdgeGraph(functional)
    const idx = indexGraph(g)
    const outs = getOutgoingEdges(idx, 'A/major').map((e) => `${e.to}:${e.type}`)
    expect(outs).toContain('F#/minor:relative') // 关系小调
    expect(outs).toContain('E/dominant7:resolution') // 逆行解决线（D 的视角 A→E7？此处 E7→A 的逆向）
    expect(outs.filter((t) => t.endsWith('modulation')).length).toBe(4) // 4 个减七枢纽逆向可入
    // 正向与逆向是不同 id、不同训练对象
    expect(getEdge(idx, 'E/dominant7', 'A/major', 'resolution')?.id).toBe(
      'E/dominant7->A/major:resolution',
    )
    expect(getEdge(idx, 'A/major', 'E/dominant7', 'resolution')?.id).toBe(
      'A/major->E/dominant7:resolution',
    )
  })

  it('转调图：减七的出边 = 8 条 modulation（4 主音 × 大/小）', () => {
    const g = toEdgeGraph(functional)
    const idx = indexGraph(g)
    expect(getOutgoingEdges(idx, 'B/diminished7')).toHaveLength(8)
    expect(getOutgoingEdges(idx, 'B/diminished7').every((e) => e.type === 'modulation')).toBe(true)
  })

  it('走线图：ii → V7 语义边消除死端（所有节点都有出边）', () => {
    const g = toEdgeGraph(voiceleading)
    const idx = indexGraph(g)
    // ii 小三的出边 = V7（cycle，pre-dominant→dominant）
    const iiOuts = getOutgoingEdges(idx, 'D/minor').map((e) => `${e.to}:${e.type}`)
    expect(iiOuts).toEqual(['G/dominant7:cycle'])
    // 无死端：每个和弦节点都有出边
    for (const nodeId of g.nodeIds) {
      expect(getOutgoingEdges(idx, nodeId).length, nodeId).toBeGreaterThan(0)
    }
    // 大三/属七有环线出边
    expect(getOutgoingEdges(idx, 'C/major').length).toBeGreaterThan(0)
    expect(getOutgoingEdges(idx, 'G/dominant7').length).toBeGreaterThan(0)
  })
})

describe('图 API 不变式（规格 §二十 参数化）', () => {
  for (const kind of ['functional', 'voiceleading'] as const) {
    it(`${kind}：所有节点的出/入边 from/to 归属正确；getEdge 可回查每条边`, () => {
      const g = toEdgeGraph(buildFigure(kind))
      const idx = indexGraph(g)
      for (const nodeId of g.nodeIds) {
        for (const e of getOutgoingEdges(idx, nodeId)) expect(e.from).toBe(nodeId)
        for (const e of getIncomingEdges(idx, nodeId)) expect(e.to).toBe(nodeId)
      }
      for (const e of g.edges) {
        const found = getEdge(idx, e.from, e.to, e.type)
        expect(found, e.id).not.toBeNull()
        expect(found?.id).toBe(e.id)
      }
    })
  }
})

describe('chordByNode：节点 id → 和弦（出题用）', () => {
  it('48 个节点全部带合法和弦', () => {
    const map = chordByNode(buildFigure('functional'))
    expect(map.size).toBe(48)
    expect(map.get('C/major')).toEqual({ root: 'C', quality: 'major' })
    expect(map.get('B/diminished7')).toEqual({ root: 'B', quality: 'diminished7' })
  })
})

describe('edgeId：稳定可预测', () => {
  it('带类型后缀，同节点对不同语义边 id 不同', () => {
    expect(edgeId('C/major', 'G/dominant7', 'cycle')).toBe('C/major->G/dominant7:cycle')
    expect(edgeId('G/dominant7', 'C/major', 'resolution')).toBe('G/dominant7->C/major:resolution')
    expect(edgeId('A', 'B', 'x')).not.toBe(edgeId('A', 'B', 'y'))
  })
})
