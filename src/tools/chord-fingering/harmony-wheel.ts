import { el } from '../../ui/dom'
import {
  buildFigure,
  FIGURE_VIEW,
  type FigureEdge,
  type FigureKind,
  type FigureNode,
  type HarmonyFigure,
} from './harmony-graph'

/**
 * 魔方图渲染器：把 harmony-graph 构建的两张图（转调图 / 走线图）渲染为 SVG。
 * 通用规则——
 * - 节点按 kind 配色（大三红 / 属七琥珀 / 小三蓝 / 减七紫 / 低音锚点灰）；
 * - 走线按 kind 定样式（解决箭头 / 关系虚线 / 减七蛛网细线 / 低音链双向箭头）；
 * - 和弦节点可点选（bass 锚点只展示）；选中 = 琥珀光环、弹奏识别 = 绿光环；
 * - 高亮规则：命中节点的**所有入射走线**同步点亮——属七点亮自己的解决线、
 *   大三点亮指向它的解决线与关系线、减七点亮全部 8 条等音转调线。
 * 所有状态由外部 set 驱动，组件无内部状态。
 */

const SVG_NS = 'http://www.w3.org/2000/svg'

/** 魔方图上的和弦（与 detectChord 的四类一致） */
export interface WheelChord {
  root: string
  quality: 'major' | 'minor' | 'dominant7' | 'diminished7'
}

const NODE_R: Readonly<Record<FigureNode['kind'], number>> = {
  major: 28,
  dominant7: 27,
  minor: 26,
  diminished7: 25,
  bass: 22,
}

/** 高亮状态类 → 箭头 marker（无对应的保持默认暗色箭头） */
const EDGE_ARROW_CLASS: Readonly<Record<string, string>> = {
  'is-selected': 'url(#hw-arrow-sel)',
  'is-played': 'url(#hw-arrow-played)',
  'is-target': 'url(#hw-arrow-sel)',
}

function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (SVGElement | string)[]
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag)
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value)
  for (const child of children) node.append(child)
  return node
}

/** 箭头 marker（开式折线箭头，颜色随走线状态区分） */
function arrowMarker(id: string, color: string): SVGMarkerElement {
  const m = svgEl('marker', {
    id,
    viewBox: '0 0 10 10',
    refX: '8',
    refY: '5',
    markerWidth: '7',
    markerHeight: '7',
    orient: 'auto-start-reverse',
  })
  m.append(
    svgEl('path', {
      d: 'M 0 1 L 9 5 L 0 9',
      fill: 'none',
      stroke: color,
      'stroke-width': '1.8',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    }),
  )
  return m
}

/** 走线两端在节点圆边缘收口（避免穿过圆内） */
function trim(
  from: { x: number; y: number },
  to: { x: number; y: number },
  gap: number,
): {
  x1: number
  y1: number
  x2: number
  y2: number
} {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  return {
    x1: from.x + ux * gap,
    y1: from.y + uy * gap,
    x2: to.x - ux * gap,
    y2: to.y - uy * gap,
  }
}

export interface HarmonyWheel {
  el: HTMLElement
  /** 选中节点（浏览/点选的和弦）；null 清除 */
  setSelected(sel: WheelChord | null): void
  /** 弹奏识别命中的节点（减七等音多拼写会命中多个）；空数组清除 */
  setPlayed(sel: WheelChord[]): void
  /** 跟弹练习的目标节点（琥珀脉冲）；null 清除 */
  setTarget(sel: WheelChord | null): void
}

export function buildHarmonyWheel(
  kind: FigureKind,
  onPick: (sel: WheelChord) => void,
): HarmonyWheel {
  const figure: HarmonyFigure = buildFigure(kind)

  const nodeByKey = new Map<string, SVGGElement>()
  /** pick 和弦 → 节点 id（弹奏识别按此匹配） */
  const nodeByChord = new Map<string, string>()
  const edgesByNode = new Map<string, FigureEdge[]>()

  const linksG = svgEl('g', { class: 'hw__links' })
  const nodesG = svgEl('g', { class: 'hw__nodes' })

  // —— 走线（先画，节点覆盖其上） ——
  for (const e of figure.edges) {
    const gap = NODE_R.major + 2
    const t = trim({ x: e.fromX, y: e.fromY }, { x: e.toX, y: e.toY }, gap)
    const attrs: Record<string, string> = {
      class: `hw__edge hw__edge--${e.kind}`,
      x1: String(t.x1),
      y1: String(t.y1),
      x2: String(t.x2),
      y2: String(t.y2),
    }
    if (e.arrows === 'end') attrs['marker-end'] = 'url(#hw-arrow)'
    if (e.arrows === 'both') {
      attrs['marker-start'] = 'url(#hw-arrow)'
      attrs['marker-end'] = 'url(#hw-arrow)'
    }
    const elEdge = svgEl('line', attrs)
    linksG.append(elEdge)
    const list = edgesByNode.get(e.fromId) ?? []
    list.push(e)
    edgesByNode.set(e.fromId, list)
    const listTo = edgesByNode.get(e.toId) ?? []
    listTo.push(e)
    edgesByNode.set(e.toId, listTo)
    ;(e as unknown as { el?: SVGLineElement }).el = elEdge
  }

  // —— 节点 ——
  for (const n of figure.nodes) {
    const r = NODE_R[n.kind]
    const g = svgEl('g', {
      class: `hw__node hw__node--${n.kind}`,
      'data-id': n.id,
      ...(n.pick ? { 'data-root': n.pick.root, 'data-quality': n.pick.quality } : {}),
    })
    if (n.pick) {
      g.setAttribute('role', 'button')
      g.classList.add('hw__node--pick')
    }
    g.append(
      svgEl('circle', { class: 'hw__hit', cx: String(n.x), cy: String(n.y), r: String(r + 8) }),
    )
    g.append(
      svgEl('circle', { class: 'hw__circle', cx: String(n.x), cy: String(n.y), r: String(r) }),
    )
    g.append(
      svgEl(
        'text',
        {
          class: 'hw__label',
          x: String(n.x),
          y: String(n.y),
          'text-anchor': 'middle',
          'dominant-baseline': 'central',
        },
        n.label,
      ),
    )
    if (n.pick) {
      g.addEventListener('pointerdown', (e) => e.preventDefault())
      g.addEventListener('click', () => onPick(n.pick!))
      nodeByChord.set(`${n.pick.root}/${n.pick.quality}`, n.id)
    }
    nodesG.append(g)
    nodeByKey.set(n.id, g)
  }

  const svg = svgEl(
    'svg',
    { class: 'hw__svg', viewBox: `0 0 ${FIGURE_VIEW} ${FIGURE_VIEW}` },
    svgEl(
      'defs',
      {},
      arrowMarker('hw-arrow', 'rgba(255, 255, 255, 0.35)'),
      arrowMarker('hw-arrow-sel', '#d9a45b'),
      arrowMarker('hw-arrow-played', '#7fb285'),
    ),
    linksG,
    nodesG,
  )

  const root = el('div', { class: 'hw' }, svg)

  /** 命中节点 + 入射走线 一起点亮/熄灭；状态类 → 箭头 marker 表驱动 */
  const highlight = (
    chords: readonly WheelChord[] | null,
    cls: 'is-selected' | 'is-played' | 'is-target',
  ): void => {
    const hitIds = new Set<string>()
    if (chords !== null) {
      for (const c of chords) {
        const id = nodeByChord.get(`${c.root}/${c.quality}`)
        if (id !== undefined) hitIds.add(id)
      }
    }
    for (const [id, g] of nodeByKey) {
      g.classList.toggle(cls, hitIds.has(id))
    }
    for (const e of figure.edges) {
      const edgeEl = (e as unknown as { el?: SVGLineElement }).el
      if (edgeEl === undefined) continue
      const on = hitIds.has(e.fromId) || hitIds.has(e.toId)
      edgeEl.classList.toggle(`is-${cls.replace('is-', '')}`, on)
      const marker = on ? EDGE_ARROW_CLASS[cls] : undefined
      if (marker !== undefined) {
        if (edgeEl.getAttribute('marker-end') !== null) edgeEl.setAttribute('marker-end', marker)
        if (edgeEl.getAttribute('marker-start') !== null)
          edgeEl.setAttribute('marker-start', marker)
      } else {
        // 恢复默认暗色箭头
        if (e.arrows === 'end') edgeEl.setAttribute('marker-end', 'url(#hw-arrow)')
        if (e.arrows === 'both') {
          edgeEl.setAttribute('marker-end', 'url(#hw-arrow)')
          edgeEl.setAttribute('marker-start', 'url(#hw-arrow)')
        }
      }
    }
  }

  return {
    el: root,
    setSelected(sel) {
      highlight(sel === null ? null : [sel], 'is-selected')
    },
    setPlayed(sel) {
      highlight(sel, 'is-played')
    },
    /** 跟弹练习的目标节点（琥珀脉冲；入射走线同亮） */
    setTarget(sel) {
      highlight(sel === null ? null : [sel], 'is-target')
    },
  }
}
