import {
  getEdge,
  indexGraph,
  type EdgeGraphIndex,
  type EdgeGraph,
  type GraphEdge,
} from './edge-graph'

/**
 * 乐句路线生成器（Phrase Walker）：让图上行进「好听」的语法层。
 *
 * 地图（harmony-graph）只保证连接合法；音乐性来自**调性语法**：
 * - 调性锚定：维护当前调（主和弦节点 + 大/小调），行进围绕它展开；
 * - 属七必解决：落在属七上，下一步回主和弦（完美终止；大小按调式偏置，
 *   偶尔同根大小互换当色彩）。路过的外来属七顺其解决，调性随解决迁移（离调）；
 * - 主音引力：从主和弦出发只去三处——属七（去属）、关系和弦、
 *   （乐句攒够后）减七枢纽转调；
 * - 转调节制：每 modulateEvery 个乐句才允许一次枢纽转调，落地新调后计数清零。
 *
 * 所有走线都是图上**真实存在**的边对象（双向语义图中按行进方向取边），
 * 边训练（mastery/path/活跃边视觉）不受影响。随机源可注入做确定性测试。
 */

export type PhraseMode = 'major' | 'minor'

export interface PhraseWalkOptions {
  rng?: () => number
  /** 完成多少个乐句后允许枢纽转调（默认 4） */
  modulateEvery?: number
}

function parseNode(nodeId: string): { root: string; quality: string } {
  const slash = nodeId.indexOf('/')
  return { root: nodeId.slice(0, slash), quality: nodeId.slice(slash + 1) }
}

type Role = 'dominant' | 'tonic' | 'relative' | 'diminished' | 'dominantOther' | 'other'

export class PhraseWalker {
  private readonly index: EdgeGraphIndex
  private readonly rng: () => number
  private readonly modulateEvery: number
  /** 当前调的主和弦节点 id（大调 = X/major，小调 = x/minor） */
  private tonicId: string
  private mode: PhraseMode
  private phrasesDone = 0

  constructor(graph: EdgeGraph, options: PhraseWalkOptions = {}) {
    this.index = indexGraph(graph)
    this.rng = options.rng ?? Math.random
    this.modulateEvery = Math.max(1, options.modulateEvery ?? 4)
    this.tonicId = 'C/major'
    this.mode = 'major'
  }

  /** 当前调性标签（UI 显示），如「C 大调」「A 小调」 */
  keyLabel(): string {
    const { root } = parseNode(this.tonicId)
    return `${root} ${this.mode === 'major' ? '大调' : '小调'}`
  }

  /** 显式设置调性（切图/定向练习后同步）；未知节点忽略 */
  setKey(tonicId: string, mode: PhraseMode): void {
    if (this.index.graph.nodeIds.includes(tonicId)) this.tonicId = tonicId
    this.mode = mode
  }

  /** 从 fromId 出发选下一条乐句路线边；无合适语法走线时返回 null（调用方回退） */
  pickNext(fromId: string): GraphEdge | null {
    switch (this.roleOf(fromId)) {
      case 'dominant':
        return this.resolveCadence(fromId, true)
      case 'dominantOther':
        return this.resolveCadence(fromId, false)
      case 'tonic':
        return this.fromTonic()
      case 'relative':
        return this.fromRelative()
      case 'diminished':
        return this.leaveDiminished(fromId)
      default:
        return null
    }
  }

  // —— 角色判定 ——
  private roleOf(nodeId: string): Role {
    if (nodeId === this.tonicId) return 'tonic'
    const q = parseNode(nodeId).quality
    if (q === 'diminished7') return 'diminished'
    if (q === 'dominant7') return nodeId === this.dominantId() ? 'dominant' : 'dominantOther'
    if (nodeId === this.relativeId()) return 'relative'
    return 'other'
  }

  /** 调内属七：与当前主和弦直连（任意边型——转调图是 resolution，走线图是 cycle）的那个 dominant7 */
  private dominantId(): string | null {
    for (const e of this.index.graph.edges) {
      if (e.to === this.tonicId && parseNode(e.from).quality === 'dominant7') {
        return e.from
      }
    }
    return null
  }

  /** 关系和弦：主和弦 relative 边的另一端 */
  private relativeId(): string | null {
    return this.relEdgeFrom(this.tonicId)?.to ?? null
  }

  /** 以 nodeId 为起点的 relative 边（双向图中按行进方向取） */
  private relEdgeFrom(nodeId: string): GraphEdge | null {
    for (const e of getOut(this.index, nodeId)) {
      if (e.type === 'relative') return e
    }
    // nodeId 是某 relative 边的 to 端：取其反向边
    for (const e of this.index.graph.edges) {
      if (e.type === 'relative' && e.to === nodeId) {
        return getEdge(this.index, nodeId, e.from, 'relative')
      }
    }
    return null
  }

  /** 解决进入 tonicId 的属七（供关系和弦离调用） */
  private incomingResDominant(tonicId: string): string | null {
    for (const e of this.index.graph.edges) {
      if (e.to === tonicId && parseNode(e.from).quality === 'dominant7') {
        return e.from
      }
    }
    return null
  }

  /** 终止式：属七必解决（落到大/小三和弦即视作解决——转调图是 resolution 边，走线图是 cycle 边） */
  private resolveCadence(v7Id: string, inKey: boolean): GraphEdge | null {
    const resEdges = getOut(this.index, v7Id).filter((e) => {
      const q = parseNode(e.to).quality
      return q === 'major' || q === 'minor'
    })
    if (resEdges.length === 0) return null
    const preferMajor = this.mode === 'major' ? this.rng() < 0.8 : this.rng() < 0.25
    let pool = resEdges.filter((e) => parseNode(e.to).quality === (preferMajor ? 'major' : 'minor'))
    if (pool.length === 0) pool = resEdges
    const edge = pool[Math.floor(this.rng() * pool.length)] ?? null
    if (edge === null) return null
    if (edge.to === this.tonicId) {
      this.phrasesDone += 1 // 完美终止：乐句完成
    } else if (!inKey || !this.isKeyRole(edge.to)) {
      this.adoptKey(edge.to) // 解决到别的主音：调性迁移（离调/转调）
    }
    return edge
  }

  /** 主和弦出发：去属七 / 去关系和弦 / （乐句攒够）减七枢纽转调 */
  private fromTonic(): GraphEdge | null {
    const due = this.phrasesDone >= this.modulateEvery
    const choices: { edge: GraphEdge; w: number }[] = []
    const domId = this.dominantId()
    if (domId !== null) {
      const e = getEdge(this.index, this.tonicId, domId)
      if (e !== null) choices.push({ edge: e, w: due ? 0.4 : 0.6 })
    }
    const rel = this.relEdgeFrom(this.tonicId)
    if (rel !== null) choices.push({ edge: rel, w: due ? 0.15 : 0.4 })
    if (due) {
      for (const e of getOut(this.index, this.tonicId)) {
        if (e.type === 'modulation') choices.push({ edge: e, w: 0.45 / 4 })
      }
    }
    const pick = this.weighted(choices)
    return pick?.edge ?? null
  }

  /** 关系和弦出发：多半回主音，少量向自己的属七离调（去而复返） */
  private fromRelative(): GraphEdge | null {
    const relId = this.relativeId()
    if (relId === null) return null
    const choices: { edge: GraphEdge; w: number }[] = []
    const back = this.relEdgeFrom(relId)
    if (back !== null) choices.push({ edge: back, w: 0.75 })
    const ownDom = this.incomingResDominant(relId)
    if (ownDom !== null) {
      const e = getEdge(this.index, relId, ownDom)
      if (e !== null) choices.push({ edge: e, w: 0.25 })
    }
    const pick = this.weighted(choices)
    if (pick !== null && pick.edge.to === this.tonicId) this.phrasesDone += 1
    return pick?.edge ?? null
  }

  /** 减七枢纽：选新主音落地（偏好大调），乐句计数清零 */
  private leaveDiminished(dimId: string): GraphEdge | null {
    const mods = getOut(this.index, dimId).filter((e) => e.type === 'modulation')
    if (mods.length === 0) return null
    const preferMajor = this.rng() < 0.65
    let pool = mods.filter((e) => parseNode(e.to).quality === (preferMajor ? 'major' : 'minor'))
    if (pool.length === 0) pool = mods
    const edge = pool[Math.floor(this.rng() * pool.length)] ?? null
    if (edge !== null) this.adoptKey(edge.to)
    return edge
  }

  /** 落点是否当前调的功能角色（主/关系）——是则不迁移调性 */
  private isKeyRole(nodeId: string): boolean {
    return nodeId === this.tonicId || nodeId === this.relativeId()
  }

  private adoptKey(tonicNodeId: string): void {
    const q = parseNode(tonicNodeId).quality
    if (q !== 'major' && q !== 'minor') return
    this.tonicId = tonicNodeId
    this.mode = q
    this.phrasesDone = 0
  }

  private weighted<T extends { edge: GraphEdge; w: number }>(items: T[]): T | null {
    const total = items.reduce((s, i) => s + i.w, 0)
    if (total <= 0 || items.length === 0) return null
    let r = this.rng() * total
    for (const it of items) {
      r -= it.w
      if (r <= 0) return it
    }
    return items[items.length - 1] ?? null
  }
}

/** 出边兜底（未知节点返回空数组） */
function getOut(index: EdgeGraphIndex, nodeId: string): GraphEdge[] {
  return index.outgoing.get(nodeId) ?? []
}
