import { noteNameToPc, type NoteName } from '../../core/chords'

/**
 * 魔方图数据（源自《Illustrated Harmony》的两张地图，几何按原图布局推导）：
 *
 * - functional「转调图」（原书图 2）：编织布局——大三在五度圈外环，小三紧贴
 *   关系大调（顺时针半扇区），属七藏在自己解决目标的内侧，减七（°）在内圈、
 *   位于其主解决目标的正下方；每个减七向 4 个等音可解决的主音家族（大/小各一）
 *   发出长走线——减七的等音多解性，就是"用图形解释转调"。
 * - voiceleading「走线图」（原书图 1）：每扇区 = 该调的 I / ii / V7 家族
 *   （小三放 ii 位），外环为大三与属七交错的双向环；24 个灰色低音锚点
 *   （大三用 4 音区、小三用 2 音区）串成低音链，走线讲低音进行与手位衔接。
 *
 * 纯数据模块：只算坐标与连边，渲染在 harmony-wheel.ts。
 */

export type FigureKind = 'functional' | 'voiceleading'

/** 节点种类（决定配色；bass 为灰色低音锚点，不可点选） */
export type FigureNodeKind = 'major' | 'minor' | 'dominant7' | 'diminished7' | 'bass'

export interface FigureNode {
  id: string
  kind: FigureNodeKind
  label: string
  x: number
  y: number
  /** 和弦节点可点选（bass 锚点无） */
  pick?: { root: NoteName; quality: 'major' | 'minor' | 'dominant7' | 'diminished7' }
}

export type FigureEdgeKind = 'ring' | 'res' | 'rel' | 'dim' | 'anchor' | 'chain'

export interface FigureEdge {
  id: string
  /** 端点节点 id（高亮按此匹配入射边） */
  fromId: string
  toId: string
  /** 端点坐标（渲染用，构建期解析） */
  fromX: number
  fromY: number
  toX: number
  toY: number
  kind: FigureEdgeKind
  arrows: 'none' | 'end' | 'both'
}

export interface HarmonyFigure {
  kind: FigureKind
  nodes: FigureNode[]
  edges: FigureEdge[]
}

/** 扇区：canonical 根音 + 显示拼写（降号侧用 ♭，与原书一致） */
const SECTORS: readonly { root: NoteName; label: string }[] = [
  { root: 'C', label: 'C' },
  { root: 'G', label: 'G' },
  { root: 'D', label: 'D' },
  { root: 'A', label: 'A' },
  { root: 'E', label: 'E' },
  { root: 'B', label: 'B' },
  { root: 'F#', label: 'F♯' },
  { root: 'Db', label: 'D♭' },
  { root: 'Ab', label: 'A♭' },
  { root: 'Eb', label: 'E♭' },
  { root: 'Bb', label: 'B♭' },
  { root: 'F', label: 'F' },
]

const VIEW = 660
const CX = VIEW / 2
const CY = VIEW / 2

function polar(radius: number, angleDeg: number): { x: number; y: number } {
  const rad = (angleDeg * Math.PI) / 180
  return { x: CX + radius * Math.cos(rad), y: CY + radius * Math.sin(rad) }
}

/** 扇区角：C 在顶部，顺时针纯五度 */
const sectorAngle = (index: number): number => -90 + index * 30
const mod12 = (i: number): number => (i + 12) % 12

export function buildFigure(kind: FigureKind): HarmonyFigure {
  const nodes: FigureNode[] = []
  const edges: FigureEdge[] = []
  const pos = new Map<string, { x: number; y: number }>()

  const addNode = (n: FigureNode): void => {
    nodes.push(n)
    pos.set(n.id, { x: n.x, y: n.y })
  }
  const addEdge = (
    fromId: string,
    toId: string,
    ekind: FigureEdgeKind,
    arrows: FigureEdge['arrows'],
  ): void => {
    const a = pos.get(fromId)
    const b = pos.get(toId)
    if (a === undefined || b === undefined) throw new Error(`走线端点缺失：${fromId} => ${toId}`)
    edges.push({
      id: `${fromId}=>${toId}`,
      fromId,
      toId,
      fromX: a.x,
      fromY: a.y,
      toX: b.x,
      toY: b.y,
      kind: ekind,
      arrows,
    })
  }

  // —— 第一遍：全部节点（走线跨扇区引用，必须先建齐） ——
  if (kind === 'functional') {
    for (let i = 0; i < 12; i++) {
      const { root, label } = SECTORS[i]
      addNode({
        ...polar(258, sectorAngle(i)),
        kind: 'major',
        label,
        pick: { root, quality: 'major' },
        id: `${root}/major`,
      })
      // 小三紧贴关系大调（五度圈 −3 扇区）顺时针半扇区
      addNode({
        ...polar(258, sectorAngle(mod12(i - 3)) + 15),
        kind: 'minor',
        label: `${label}m`,
        pick: { root, quality: 'minor' },
        id: `${root}/minor`,
      })
      // 属七藏进解决目标（五度圈 −1 扇区）正内侧
      addNode({
        ...polar(200, sectorAngle(mod12(i - 1))),
        kind: 'dominant7',
        label: `${label}7`,
        pick: { root, quality: 'dominant7' },
        id: `${root}/dominant7`,
      })
      // 减七位于其主解决目标（根音上行半音 = 五度圈 +7 扇区）正下方
      addNode({
        ...polar(140, sectorAngle(mod12(i + 7)) + 10),
        kind: 'diminished7',
        label: `${label}°`,
        pick: { root, quality: 'diminished7' },
        id: `${root}/diminished7`,
      })
    }
  } else {
    for (let i = 0; i < 12; i++) {
      const { root, label } = SECTORS[i]
      const domSector = mod12(i + 1)
      const iiSector = mod12(i + 2)
      addNode({
        ...polar(258, sectorAngle(i)),
        kind: 'major',
        label,
        pick: { root, quality: 'major' },
        id: `${root}/major`,
      })
      // V7 放在外环上、I 与 V 之间（自身扇区逆时针半扇区）
      addNode({
        ...polar(258, sectorAngle(domSector) - 15),
        kind: 'dominant7',
        label: `${SECTORS[domSector].label}7`,
        pick: { root: SECTORS[domSector].root, quality: 'dominant7' },
        id: `${SECTORS[domSector].root}/dominant7`,
      })
      // ii 小三（五度圈 +2 扇区）画在本扇区内侧
      addNode({
        ...polar(160, sectorAngle(i)),
        kind: 'minor',
        label: `${SECTORS[iiSector].label}m`,
        pick: { root: SECTORS[iiSector].root, quality: 'minor' },
        id: `${SECTORS[iiSector].root}/minor`,
      })
      // 灰色低音锚点：大三用 4 音区、ii 小三用 2 音区
      addNode({
        ...polar(205, sectorAngle(i)),
        kind: 'bass',
        label: `${label}4`,
        id: `bass:${label}4`,
      })
      addNode({
        ...polar(108, sectorAngle(i)),
        kind: 'bass',
        label: `${SECTORS[iiSector].label}2`,
        id: `bass:${SECTORS[iiSector].label}2`,
      })
    }
  }

  // —— 第二遍：全部走线 ——
  for (let i = 0; i < 12; i++) {
    const { root, label } = SECTORS[i]
    if (kind === 'functional') {
      // 属七解决：X7 → 主音大三 与 小三（V7→I / V7→i）
      const target = mod12(i - 1)
      addEdge(`${root}/dominant7`, `${SECTORS[target].root}/major`, 'res', 'end')
      addEdge(`${root}/dominant7`, `${SECTORS[target].root}/minor`, 'res', 'end')
      // 关系大小调：大三(i) ↔ 小三(i+3)
      addEdge(`${root}/major`, `${SECTORS[mod12(i + 3)].root}/minor`, 'rel', 'both')
      // 减七等音多解：X° → 4 个可解决主音（半音 +1/+4/+7/+10）的大三与小三
      const pc = noteNameToPc(root)
      for (const offset of [1, 4, 7, 10]) {
        const tonicPc = (pc + offset) % 12
        const t = SECTORS.findIndex((s) => noteNameToPc(s.root) === tonicPc)
        addEdge(`${root}/diminished7`, `${SECTORS[t].root}/major`, 'dim', 'none')
        addEdge(`${root}/diminished7`, `${SECTORS[t].root}/minor`, 'dim', 'none')
      }
    } else {
      const domSector = mod12(i + 1)
      const iiSector = mod12(i + 2)
      const dom = `${SECTORS[domSector].root}/dominant7`
      // 外环：I ↔ V7 ↔ V（双向，任何方向都可走）
      addEdge(`${root}/major`, dom, 'ring', 'both')
      addEdge(dom, `${SECTORS[domSector].root}/major`, 'ring', 'both')
      // 和弦 → 自己的低音锚点；ii 锚点竖连 I 锚点
      addEdge(`${root}/major`, `bass:${label}4`, 'anchor', 'none')
      addEdge(
        `${SECTORS[iiSector].root}/minor`,
        `bass:${SECTORS[iiSector].label}2`,
        'anchor',
        'none',
      )
      addEdge(`${SECTORS[iiSector].root}/minor`, `bass:${label}4`, 'anchor', 'none')
      addEdge(`bass:${SECTORS[iiSector].label}2`, `bass:${label}4`, 'anchor', 'none')
      // 低音链：4 区与 2 区各自沿五度圈双向走；ii 低音 → V 的低音（上四度）
      addEdge(`bass:${label}4`, `bass:${SECTORS[domSector].label}4`, 'chain', 'both')
      addEdge(
        `bass:${SECTORS[iiSector].label}2`,
        `bass:${SECTORS[mod12(iiSector + 1)].label}2`,
        'chain',
        'both',
      )
      addEdge(
        `bass:${SECTORS[iiSector].label}2`,
        `bass:${SECTORS[domSector].label}4`,
        'chain',
        'both',
      )
    }
  }

  return { kind, nodes, edges }
}

export { SECTORS as FIGURE_SECTORS, VIEW as FIGURE_VIEW }
