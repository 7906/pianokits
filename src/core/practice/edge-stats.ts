/**
 * 边级训练状态（Edge Mastery）：每条有向边独立的练习记录与熟练度。
 *
 * 算法刻意保持简单、可解释（第一版不引入 FSRS）：
 * - accuracy = (successes + 1) / (attempts + 2)——拉普拉斯平滑（先验 1 成 2 次），
 *   避免「一次侥幸即满熟练 / 一次失误即永无出头」；
 * - speedScore = clamp(1 - (avgMs - 1000) / 4000, 0, 1)——平均 1s 内 = 1，3s = 0.5，≥5s = 0
 *   （平均时长只统计成功作答的响应时间）；
 * - mastery = accuracy × 0.7 + speedScore × 0.3；从未练过的边 mastery = 0.5（中性，鼓励探索）。
 *
 * 持久化：可注入 KeyValueStorage（浏览器传 localStorage），key 带版本号便于迁移；
 * 解析损坏数据安全回退为空状态，不影响基本功能。
 */

/** 单条边的训练统计 */
export interface EdgeStats {
  attempts: number
  successes: number
  failures: number
  consecutiveSuccesses: number
  /** 成功作答的响应时间累计（毫秒）；失败不计入时长 */
  totalResponseTimeMs: number
  /** 最近一次练习的时间戳（Date.now()） */
  lastPracticedAt: number
}

export function emptyEdgeStats(): EdgeStats {
  return {
    attempts: 0,
    successes: 0,
    failures: 0,
    consecutiveSuccesses: 0,
    totalResponseTimeMs: 0,
    lastPracticedAt: 0,
  }
}

/** 响应时间 → 得分（0..1）：1s 内满分，每慢 4s 线性衰减，5s 起 0 分 */
export function speedScore(avgResponseTimeMs: number): number {
  return Math.max(0, Math.min(1, 1 - (avgResponseTimeMs - 1000) / 4000))
}

/** 熟练度（0..1）。未练过 = 0.5；已练 = 0.7×平滑正确率 + 0.3×速度分 */
export function computeMastery(stats: EdgeStats): number {
  if (stats.attempts === 0) return 0.5
  const accuracy = (stats.successes + 1) / (stats.attempts + 2)
  const avg = stats.successes > 0 ? stats.totalResponseTimeMs / stats.successes : 5000
  return accuracy * 0.7 + speedScore(avg) * 0.3
}

/** 最小存储接口（localStorage 兼容；测试用内存实现注入） */
export interface KeyValueStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** 存储键（版本号在 key 中，未来迁移换 v2） */
export const EDGE_STATS_STORAGE_KEY = 'pianokits:chord-fingering:edge-stats:v1'

/** 持久化数据形状：{ version: 1, edges: { [edgeId]: EdgeStats } } */
interface StoredShape {
  version: number
  edges: Record<string, EdgeStats>
}

function isEdgeStatsShape(v: unknown): v is EdgeStats {
  if (typeof v !== 'object' || v === null) return false
  const s = v as Record<string, unknown>
  return (
    typeof s.attempts === 'number' &&
    typeof s.successes === 'number' &&
    typeof s.failures === 'number' &&
    typeof s.consecutiveSuccesses === 'number' &&
    typeof s.totalResponseTimeMs === 'number' &&
    typeof s.lastPracticedAt === 'number'
  )
}

export interface EdgeStatsRecordOptions {
  success: boolean
  /** 成功作答的响应时间（毫秒）；失败时忽略 */
  responseTimeMs?: number
  /** 最近练习时间戳；缺省取当前时间 */
  now?: number
}

export class EdgeStatsStore {
  private readonly data = new Map<string, EdgeStats>()
  private readonly storage: KeyValueStorage | null
  private readonly key: string

  constructor(storage?: KeyValueStorage | null, key: string = EDGE_STATS_STORAGE_KEY) {
    this.storage = storage ?? null
    this.key = key
    this.load()
  }

  private load(): void {
    if (this.storage === null) return
    let raw: string | null
    try {
      raw = this.storage.getItem(this.key)
    } catch {
      return // 存储不可用（隐私模式等）：空状态运行
    }
    if (raw === null) return
    try {
      const parsed: unknown = JSON.parse(raw)
      if (typeof parsed !== 'object' || parsed === null) return
      const shape = parsed as Record<string, unknown>
      if (shape.version !== 1 || typeof shape.edges !== 'object' || shape.edges === null) return
      for (const [id, value] of Object.entries(shape.edges)) {
        if (isEdgeStatsShape(value)) this.data.set(id, { ...value })
      }
    } catch {
      // 损坏数据：安全回退为空状态
      this.data.clear()
    }
  }

  private save(): void {
    if (this.storage === null) return
    const shape: StoredShape = { version: 1, edges: Object.fromEntries(this.data) }
    try {
      this.storage.setItem(this.key, JSON.stringify(shape))
    } catch {
      // 写入失败（配额/隐私模式）：内存态继续，不影响本次练习
    }
  }

  /** 单边统计（无记录返回空对象） */
  get(edgeId: string): EdgeStats {
    const s = this.data.get(edgeId)
    return s ?? emptyEdgeStats()
  }

  /** 记录一次作答（成功 / 失败各计一次 attempt；成功额外累计时长与连对） */
  recordResult(edgeId: string, options: EdgeStatsRecordOptions): EdgeStats {
    const s = this.get(edgeId)
    const next: EdgeStats = {
      attempts: s.attempts + 1,
      successes: s.successes + (options.success ? 1 : 0),
      failures: s.failures + (options.success ? 0 : 1),
      consecutiveSuccesses: options.success ? s.consecutiveSuccesses + 1 : 0,
      totalResponseTimeMs:
        s.totalResponseTimeMs +
        (options.success && options.responseTimeMs !== undefined && options.responseTimeMs > 0
          ? options.responseTimeMs
          : 0),
      lastPracticedAt: options.now ?? Date.now(),
    }
    this.data.set(edgeId, next)
    this.save()
    return next
  }

  /** 熟练度 0..1（未练过 = 0.5） */
  mastery(edgeId: string): number {
    return computeMastery(this.get(edgeId))
  }

  /**
   * 薄弱连接清单：有作答记录的边按 mastery 升序，取前 limit 条。
   * 返回 [edgeId, mastery, stats]，供「薄弱连接」视图直接渲染。
   */
  weakest(limit: number): { edgeId: string; mastery: number; stats: EdgeStats }[] {
    return [...this.data.entries()]
      .filter(([, s]) => s.attempts > 0)
      .map(([edgeId, s]) => ({ edgeId, mastery: computeMastery(s), stats: s }))
      .sort((a, b) => a.mastery - b.mastery)
      .slice(0, limit)
  }

  /** 已有记录的边数（测试 / 调试用） */
  get size(): number {
    return this.data.size
  }
}
