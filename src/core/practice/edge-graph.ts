/**
 * 通用有向边图（Graph-Driven 训练的图语义层）：
 * 节点是字符串 id，边是「有向、带类型、带权重」的训练对象——
 * C→G7 与 G7→C 是两条不同的边，可拥有不同 mastery。
 *
 * 本模块只提供纯函数：不依赖 DOM / MIDI / UI；随机源可注入以便确定性测试。
 * 和声语义（哪些边存在、类型、权重）由调用方给出——工具侧的
 * `tools/chord-fingering/harmony-graph.ts` 是和声图唯一真相来源，经适配器投影为本模型。
 */

/** 有向语义边。id 稳定可预测：`${from}->${to}:${type}`（同节点对可有不同语义边，故恒带类型） */
export interface GraphEdge {
  readonly id: string
  readonly from: string
  readonly to: string
  readonly type: string
  /** 基础权重（>0）：采样概率 ∝ weight × weaknessMultiplier(mastery) */
  readonly weight: number
}

/** 最小边图：训练只需要节点 id 全集与有向边列表 */
export interface EdgeGraph {
  readonly nodeIds: readonly string[]
  readonly edges: readonly GraphEdge[]
}

/** 图索引：邻接表 + 边按 id（构建一次反复查询） */
export interface EdgeGraphIndex {
  readonly graph: EdgeGraph
  readonly outgoing: ReadonlyMap<string, GraphEdge[]>
  readonly incoming: ReadonlyMap<string, GraphEdge[]>
  readonly edgeById: ReadonlyMap<string, GraphEdge>
}

/** 构建邻接索引（出边 / 入边 / 按 id 取边） */
export function indexGraph(graph: EdgeGraph): EdgeGraphIndex {
  const outgoing = new Map<string, GraphEdge[]>()
  const incoming = new Map<string, GraphEdge[]>()
  const edgeById = new Map<string, GraphEdge>()
  for (const nodeId of graph.nodeIds) {
    outgoing.set(nodeId, [])
    incoming.set(nodeId, [])
  }
  for (const edge of graph.edges) {
    edgeById.set(edge.id, edge)
    const out = outgoing.get(edge.from)
    if (out !== undefined) out.push(edge)
    const inc = incoming.get(edge.to)
    if (inc !== undefined) inc.push(edge)
  }
  return { graph, outgoing, incoming, edgeById }
}

/** 节点的全部出边（nodeId 不在图中返回空数组） */
export function getOutgoingEdges(index: EdgeGraphIndex, nodeId: string): readonly GraphEdge[] {
  return index.outgoing.get(nodeId) ?? []
}

/** 节点的全部入边（nodeId 不在图中返回空数组） */
export function getIncomingEdges(index: EdgeGraphIndex, nodeId: string): readonly GraphEdge[] {
  return index.incoming.get(nodeId) ?? []
}

/** 按端点找边（同节点对多条语义边时返回第一条）；可选按类型精确匹配 */
export function getEdge(
  index: EdgeGraphIndex,
  from: string,
  to: string,
  type?: string,
): GraphEdge | null {
  for (const edge of getOutgoingEdges(index, from)) {
    if (edge.to !== to) continue
    if (type === undefined || edge.type === type) return edge
  }
  return null
}

/** 稳定边 id（唯一真相：同节点对不同语义边靠 type 区分） */
export function edgeId(from: string, to: string, type: string): string {
  return `${from}->${to}:${type}`
}

/**
 * 熟练度 → 采样倍率：低熟练多练，高熟练少练但**永不清零**。
 * 分档（可解释、可调整）：m<0.3→×3，m<0.6→×2，m<0.85→×1，m≥0.85→×0.5。
 */
export function weaknessMultiplier(mastery: number): number {
  if (mastery < 0.3) return 3
  if (mastery < 0.6) return 2
  if (mastery < 0.85) return 1
  return 0.5
}

/** 有效权重 = 基础权重 × 薄弱倍率 */
export function effectiveWeight(baseWeight: number, mastery: number): number {
  return baseWeight * weaknessMultiplier(mastery)
}

export interface PickNextEdgeOptions {
  /** 防弹跳：避开该节点（通常是刚离开的上一个节点，避免 A→B→A） */
  avoidNodeId?: string
  /** 边 id → mastery（0..1）；未提供视为 0.5（未练过=中性偏弱，鼓励探索） */
  masteryOf?: (edgeId: string) => number
  /** 随机源 [0,1)；可注入做确定性测试 */
  random?: () => number
  /**
   * 贪心策略（Mode B「预测」用）：不走加权随机，改选**最高基础权重**的出边
   * （忽略 mastery——路线须可学习），同权重按目标节点 id 字典序，完全确定。
   */
  greedy?: boolean
}

/**
 * 从 currentNode 的**合法出边**中加权选择下一条边（绝不全局随机选节点）。
 * 先过滤 avoidNodeId，若过滤后为空则回退全部出边（系统始终可运行）。
 * 无任何出边返回 null（调用方处理死端）。
 */
export function pickNextEdge(
  index: EdgeGraphIndex,
  currentNodeId: string,
  options: PickNextEdgeOptions = {},
): GraphEdge | null {
  const all = getOutgoingEdges(index, currentNodeId)
  if (all.length === 0) return null
  const avoid = options.avoidNodeId
  const candidates = avoid === undefined ? all : all.filter((e) => e.to !== avoid)
  const pool = candidates.length > 0 ? candidates : all
  if (options.greedy === true) {
    const sorted = [...pool].sort(
      (x, y) => y.weight - x.weight || (x.to < y.to ? -1 : x.to > y.to ? 1 : 0),
    )
    return sorted[0] ?? null
  }
  const masteryOf = options.masteryOf ?? (() => 0.5)
  const weights = pool.map((e) => effectiveWeight(e.weight, masteryOf(e.id)))
  const total = weights.reduce((s, w) => s + w, 0)
  const random = options.random ?? Math.random
  let r = random() * total
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i]
    const edge = pool[i]
    if (r <= 0 && edge !== undefined) return edge
  }
  const last = pool[pool.length - 1]
  return last ?? null
}
