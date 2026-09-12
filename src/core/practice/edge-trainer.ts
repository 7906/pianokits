/**
 * Edge Trainer（和声图行进训练器）：
 * 「弹对后下一步去哪」——沿图的**有向边**产生连续和弦路径，边级熟练度影响采样概率。
 *
 * 三职责分离（与 ChordPracticeEngine / EdgeStatsStore 的边界）：
 * - ChordPracticeEngine：「用户是否弹对这个和弦？」（集合判定）
 * - EdgeTrainer（本类）：「弹对后下一步去哪？」（当前节点 / 活跃边 / 目标节点 / 路径）
 * - EdgeStatsStore：「哪些连接应该多练？」（边级统计与熟练度）
 *
 * 状态设计面向未来的 Mode B（预测）/ Mode C（盲走）预留：状态暴露 current/target/activeEdge
 * 与 recentPath，不绑定「目标始终可见」的 Mode A 假设。
 */
import {
  indexGraph,
  pickNextEdge,
  type EdgeGraph,
  type EdgeGraphIndex,
  type GraphEdge,
} from './edge-graph'
import type { EdgeStatsStore } from './edge-stats'

/** 路径上的一步：一条被作答过的有向边 */
export interface TrainerPathStep {
  edgeId: string
  from: string
  to: string
  result: 'success' | 'failure'
  responseTimeMs?: number
}

/** 训练会话计数（本次开关开启以来） */
export interface TrainerSession {
  steps: number
  successes: number
  failures: number
}

export interface TrainerState {
  /** 当前所在节点（活跃边的 from） */
  currentNodeId: string
  /** 目标节点（活跃边的 to）；无活跃边（死端跳步中）为 null */
  targetNodeId: string | null
  /** 当前活跃边（正在训练的转换）；null = 尚未开始或刚发生死端跳步 */
  activeEdgeId: string | null
  /** 最近路径（最多 50 步，新在前？——按时间正序保存，截断保留最近） */
  recentPath: readonly TrainerPathStep[]
  readonly session: TrainerSession
}

export const MAX_PATH_LENGTH = 50

export type TrainerStrategy = 'random' | 'greedy'

export interface EdgeTrainerOptions {
  /** 边级统计存储：采样权重读 mastery，作答结果写入此处 */
  stats?: EdgeStatsStore
  /** 随机源（可注入做确定性测试） */
  random?: () => number
  /** 选边策略：random = 加权随机（Mode A 跟弹）；greedy = 最高权重确定路线（Mode B 预测，可学习） */
  strategy?: TrainerStrategy
}

export class EdgeTrainer {
  private readonly index: EdgeGraphIndex
  private readonly stats: EdgeStatsStore | null
  private readonly random: () => number
  private strategy: TrainerStrategy
  private currentNode: string | null = null
  private activeEdge: GraphEdge | null = null
  private path: TrainerPathStep[] = []
  private readonly session: TrainerSession = { steps: 0, successes: 0, failures: 0 }
  /** 当前活跃边是否已记录结果（一题只记一次成功/失败） */
  private reported = true

  constructor(graph: EdgeGraph, options: EdgeTrainerOptions = {}) {
    this.index = indexGraph(graph)
    this.stats = options.stats ?? null
    this.random = options.random ?? Math.random
    this.strategy = options.strategy ?? 'random'
  }

  /** 切换选边策略（跟弹↔预测）；不清空路径与统计 */
  setStrategy(strategy: TrainerStrategy): void {
    this.strategy = strategy
  }

  /** 定向练习：强制以指定边为当前活跃边（薄弱连接点击即练）；边不存在返回 false */
  focusEdge(edgeId: string): boolean {
    const edge = this.index.edgeById.get(edgeId)
    if (edge === undefined) return false
    this.currentNode = edge.from
    this.activeEdge = edge
    this.reported = false
    return true
  }

  get currentNodeId(): string | null {
    return this.currentNode
  }

  get targetNodeId(): string | null {
    return this.activeEdge?.to ?? null
  }

  get activeEdgeId(): string | null {
    return this.activeEdge?.id ?? null
  }

  /** 开始训练：落在 startNodeId（缺省/非法则随机），并选出第一条活跃边 */
  start(startNodeId?: string): void {
    const valid =
      startNodeId !== undefined && this.index.graph.nodeIds.includes(startNodeId)
        ? startNodeId
        : this.randomNode()
    this.currentNode = valid
    this.activeEdge = null
    this.advance()
  }

  /**
   * 推进到下一转换：从当前节点沿出边选下一条（熟练度加权 + 避开刚离开的节点
   * 防 A→B→A；过滤致空则回退）。当前图无出边（死端）时跳到随机其他节点再选一次。
   */
  advance(): void {
    if (this.currentNode === null) return
    // 弹对后用户已站在活跃边的目标节点上：从那里出发选下一条；
    // avoid = 刚离开的节点（活跃边的 from），防 A→B→A
    let from = this.activeEdge?.to ?? this.currentNode
    const avoid = this.activeEdge?.from
    const masteryOf = (id: string): number => this.stats?.mastery(id) ?? 0.5
    let edge = pickNextEdge(this.index, from, {
      avoidNodeId: avoid,
      masteryOf,
      random: this.random,
      greedy: this.strategy === 'greedy',
    })
    if (edge === null) {
      // 死端（如走线图的 ii 小三只有视觉锚点连线）：跳到随机其他节点再试一次
      const jump = this.randomNode(this.currentNode)
      if (jump === null) return
      from = jump
      edge = pickNextEdge(this.index, from, {
        masteryOf,
        random: this.random,
        greedy: this.strategy === 'greedy',
      })
      if (edge === null) return
    }
    this.currentNode = from
    this.activeEdge = edge
    this.reported = false
  }

  /**
   * 记录当前活跃边的一次作答（成功 / 失败）。一题只记一次：advance 前的重复
   * 调用被忽略；失败不打断训练，用户可继续作答直到成功后 advance。
   */
  reportResult(success: boolean, responseTimeMs?: number): void {
    const edge = this.activeEdge
    if (edge === null || this.reported) return
    this.reported = true
    this.stats?.recordResult(edge.id, { success, responseTimeMs })
    this.session.steps += 1
    if (success) this.session.successes += 1
    else this.session.failures += 1
    this.path.push({
      edgeId: edge.id,
      from: edge.from,
      to: edge.to,
      result: success ? 'success' : 'failure',
      ...(success && responseTimeMs !== undefined ? { responseTimeMs } : {}),
    })
    if (this.path.length > MAX_PATH_LENGTH) this.path.shift()
  }

  /** 路径最近 n 步（时间正序） */
  recentPath(n = MAX_PATH_LENGTH): readonly TrainerPathStep[] {
    return this.path.slice(Math.max(0, this.path.length - n))
  }

  state(): TrainerState {
    return {
      currentNodeId: this.currentNode ?? '',
      targetNodeId: this.targetNodeId,
      activeEdgeId: this.activeEdgeId,
      recentPath: this.recentPath(),
      session: { ...this.session },
    }
  }

  private randomNode(exclude?: string): string | null {
    const ids = this.index.graph.nodeIds.filter((id) => id !== exclude)
    if (ids.length === 0) return null
    const i = Math.floor(this.random() * ids.length)
    const id = ids[Math.min(ids.length - 1, Math.max(0, i))]
    return id ?? null
  }
}
