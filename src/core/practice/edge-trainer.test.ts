import { describe, expect, it, vi } from 'vitest'

import { EdgeTrainer, MAX_PATH_LENGTH, type TrainerState } from './edge-trainer'
import { EdgeStatsStore } from './edge-stats'
import { ChordPracticeEngine } from './chord-practice'
import type { EdgeGraph } from './edge-graph'

/** 线性图：a -> b -> c -> a（全部 resolution，权重 4） */
function triangle(): EdgeGraph {
  return {
    nodeIds: ['a', 'b', 'c'],
    edges: [
      { id: 'a->b:resolution', from: 'a', to: 'b', type: 'resolution', weight: 4 },
      { id: 'b->c:resolution', from: 'b', to: 'c', type: 'resolution', weight: 4 },
      { id: 'c->a:resolution', from: 'c', to: 'a', type: 'resolution', weight: 4 },
    ],
  }
}

function stateOf(tr: EdgeTrainer): TrainerState {
  return tr.state()
}

describe('EdgeTrainer：沿边行进', () => {
  it('start 未给起点则随机落子并选出第一条活跃边（target = 出边终点）', () => {
    const tr = new EdgeTrainer(triangle(), { random: () => 0 })
    tr.start()
    const s = stateOf(tr)
    expect(s.currentNodeId).toBe('a') // random()=0 → 第一个节点
    expect(s.activeEdgeId).toBe('a->b:resolution')
    expect(s.targetNodeId).toBe('b')
  })

  it('start 给定起点则从该节点出发；指定 startNodeId 直达', () => {
    const tr = new EdgeTrainer(triangle(), { random: () => 0 })
    tr.start('b')
    expect(stateOf(tr).currentNodeId).toBe('b')
    expect(stateOf(tr).targetNodeId).toBe('c')
  })

  it('advance 沿图推进且避开 A→B→A（三角图上 b 的下一目标不会是 a 刚离开……此处 a→b 后 b 只能去 c）', () => {
    const tr = new EdgeTrainer(triangle(), { random: () => 0 })
    tr.start('a') // a → b
    tr.reportResult(true, 1000)
    tr.advance() // 从 b 出发，avoid a → b→c
    const s = stateOf(tr)
    expect(s.currentNodeId).toBe('b')
    expect(s.activeEdgeId).toBe('b->c:resolution')
    expect(s.targetNodeId).toBe('c')
  })

  it('双节点互连图：avoid 过滤致空时回退（A→B→A 允许，因无其他合法边）', () => {
    const g: EdgeGraph = {
      nodeIds: ['a', 'b'],
      edges: [
        { id: 'a->b:x', from: 'a', to: 'b', type: 'x', weight: 1 },
        { id: 'b->a:x', from: 'b', to: 'a', type: 'x', weight: 1 },
      ],
    }
    const tr = new EdgeTrainer(g, { random: () => 0 })
    tr.start('a') // a → b
    tr.reportResult(true, 500)
    tr.advance() // b 只有回 a 的边：回退生效，仍可继续
    expect(stateOf(tr).targetNodeId).toBe('a')
  })

  it('死端节点：跳到随机其他节点继续（系统始终可运行）', () => {
    const g: EdgeGraph = {
      nodeIds: ['dead', 'a', 'b'],
      edges: [{ id: 'a->b:x', from: 'a', to: 'b', type: 'x', weight: 1 }],
    }
    const tr = new EdgeTrainer(g, { random: () => 0 }) // 落 dead；随机 0 → 跳到 a
    tr.start('dead')
    const s = stateOf(tr)
    expect(s.currentNodeId).not.toBe('dead')
    expect(s.targetNodeId).not.toBeNull()
  })
})

describe('EdgeTrainer：记录与路径', () => {
  it('reportResult：成功/失败入账，session 计数，响应时间只随成功记录', () => {
    const tr = new EdgeTrainer(triangle(), { random: () => 0 })
    tr.start('a')
    tr.reportResult(true, 1200)
    tr.advance()
    tr.reportResult(false)
    const s = stateOf(tr)
    expect(s.session).toEqual({ steps: 2, successes: 1, failures: 1 })
    expect(s.recentPath[0]).toEqual({
      edgeId: 'a->b:resolution',
      from: 'a',
      to: 'b',
      result: 'success',
      responseTimeMs: 1200,
    })
    expect(s.recentPath[1]).toEqual({
      edgeId: 'b->c:resolution',
      from: 'b',
      to: 'c',
      result: 'failure',
    })
  })

  it('同一题只记一次：未 advance 前重复 report 被忽略', () => {
    const store = new EdgeStatsStore(null)
    const tr = new EdgeTrainer(triangle(), { stats: store, random: () => 0 })
    tr.start('a')
    tr.reportResult(true, 900)
    tr.reportResult(true, 900)
    tr.reportResult(false)
    expect(store.get('a->b:resolution').attempts).toBe(1)
    expect(stateOf(tr).session.steps).toBe(1)
  })

  it('路径历史上限 50 步（FIFO 截断）', () => {
    const tr = new EdgeTrainer(triangle(), { random: () => 0 })
    tr.start('a')
    for (let i = 0; i < 120; i++) {
      tr.reportResult(i % 3 !== 0, 800)
      tr.advance()
    }
    expect(stateOf(tr).recentPath.length).toBe(MAX_PATH_LENGTH)
    // recentPath(n) 可取更短窗口
    expect(tr.recentPath(3).length).toBe(3)
  })

  it('mastery 影响采样（弱边被选中更多）+ 记录与采样同源', () => {
    // 双出边图：a→weak(1) a→strong(1)，让 weak 熟练度极低
    const g: EdgeGraph = {
      nodeIds: ['a', 'w', 's'],
      edges: [
        { id: 'a->w:x', from: 'a', to: 'w', type: 'x', weight: 1 },
        { id: 'a->s:x', from: 'a', to: 's', type: 'x', weight: 1 },
        { id: 'w->a:x', from: 'w', to: 'a', type: 'x', weight: 1 },
        { id: 's->a:x', from: 's', to: 'a', type: 'x', weight: 1 },
      ],
    }
    const store = new EdgeStatsStore(null)
    for (let i = 0; i < 6; i++) store.recordResult('a->w:x', { success: false, now: i })
    for (let i = 0; i < 6; i++)
      store.recordResult('a->s:x', { success: true, responseTimeMs: 800, now: i })
    const tr = new EdgeTrainer(g, { stats: store, random: Math.random })
    let weak = 0
    for (let i = 0; i < 200; i++) {
      tr.start('a') // 每轮都从 a 出发采样（无 avoid），权重完全由 mastery 决定
      if (stateOf(tr).targetNodeId === 'w') weak += 1
    }
    expect(weak).toBeGreaterThan(130) // weak 有效权重 3x vs strong 0.5x
  })
})

describe('EdgeTrainer + ChordPracticeEngine 集成（判定/行进/统计分离）', () => {
  it('引擎判对 → trainer 记成功 → 推进到下一目标（验收 B/F 流程）', () => {
    const store = new EdgeStatsStore(null)
    const tr = new EdgeTrainer(triangle(), { stats: store, random: () => 0 })
    tr.start('a') // 目标 b
    const engine = new ChordPracticeEngine()
    const onSolved = vi.fn()
    engine.onSolved(onSolved)
    // 目标出现（模拟出题）：setQuestion 为目标的「音高」——这里以节点 id 代音高验证管线
    engine.setQuestion([60, 64, 67])
    engine.setHeld([60, 64, 67])
    expect(onSolved).toHaveBeenCalledTimes(1)
    tr.reportResult(true, 1100) // UI 在 onSolved 回调里调用
    tr.advance()
    const s = stateOf(tr)
    expect(store.get('a->b:resolution').attempts).toBe(1)
    expect(store.get('a->b:resolution').successes).toBe(1)
    expect(s.activeEdgeId).toBe('b->c:resolution')
    expect(s.targetNodeId).toBe('c')
  })
})

describe('EdgeTrainer：strategy 与 focusEdge', () => {
  it('greedy 策略：advance 沿最高权重确定路线', () => {
    const g: EdgeGraph = {
      nodeIds: ['a', 'b', 'c'],
      edges: [
        { id: 'a->b:resolution', from: 'a', to: 'b', type: 'resolution', weight: 4 },
        { id: 'a->c:relative', from: 'a', to: 'c', type: 'relative', weight: 2 },
        { id: 'b->a:resolution', from: 'b', to: 'a', type: 'resolution', weight: 4 },
        { id: 'c->a:resolution', from: 'c', to: 'a', type: 'resolution', weight: 4 },
      ],
    }
    const tr = new EdgeTrainer(g, { strategy: 'greedy', random: Math.random })
    tr.start('a')
    expect(stateOf(tr).targetNodeId).toBe('b') // resolution(4) > relative(2)
  })

  it('setStrategy 可切换；focusEdge 定向到指定边并可直接作答', () => {
    const store = new EdgeStatsStore(null)
    const tr = new EdgeTrainer(triangle(), { stats: store, random: () => 0 })
    tr.setStrategy('greedy')
    tr.start('a')
    expect(stateOf(tr).targetNodeId).toBe('b')
    expect(tr.focusEdge('c->a:resolution')).toBe(true)
    const s = stateOf(tr)
    expect(s.currentNodeId).toBe('c')
    expect(s.targetNodeId).toBe('a')
    tr.reportResult(true, 900)
    expect(store.get('c->a:resolution').successes).toBe(1)
    expect(tr.focusEdge('nope')).toBe(false)
  })
})
