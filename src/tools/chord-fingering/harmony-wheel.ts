import { el } from '../../ui/dom'

/**
 * 和弦魔方（和声轮）：源自《Illustrated Harmony》的图形走线思路——
 * 12 个扇区按五度圈排列（C 在顶部、顺时针纯五度），每扇区三层节点：
 * 外层大三（红）、中层属七（琥珀）、内层小三（蓝）。
 *
 * 常驻走线（暗色）：属七 → 上方一扇区的大三（V7→I 解决）、大三 ↔ 同扇区小三
 * （关系大小调）。选中 / 弹奏的节点高亮，经过它的走线同步点亮。
 * 点击节点切换和弦；弹琴时由 detectChord 实时定位所弹和弦的节点。
 * 纯展示组件：不依赖 core（扇区序由调用方传入），所有状态由外部 set 驱动。
 */

const SVG_NS = 'http://www.w3.org/2000/svg'

/** 魔方图上的和弦（与 detectChord 的三类一致） */
export interface WheelChord {
  root: string
  quality: 'major' | 'minor' | 'dominant7'
}

/** 扇区顺序（canonical 拼写）与显示拼写（降号侧用 ♭，与原书一致） */
const SECTORS: readonly { root: string; label: string }[] = [
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
/** 三层节点半径（外→内：大三 / 属七 / 小三） */
const RADIUS: Readonly<Record<WheelChord['quality'], number>> = {
  major: 258,
  dominant7: 200,
  minor: 142,
}
const NODE_R: Readonly<Record<WheelChord['quality'], number>> = {
  major: 28,
  dominant7: 27,
  minor: 26,
}
const QUALITY_SUFFIX: Readonly<Record<WheelChord['quality'], string>> = {
  major: '',
  dominant7: '7',
  minor: 'm',
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

/** 扇区角（度）：C 在顶部，顺时针纯五度 */
function sectorAngle(index: number): number {
  return -90 + index * 30
}

function polar(radius: number, angleDeg: number): { x: number; y: number } {
  const rad = (angleDeg * Math.PI) / 180
  return { x: CX + radius * Math.cos(rad), y: CY + radius * Math.sin(rad) }
}

/** 两节点间的解决走线：微弯曲线（控制点向外推），终点在目标节点边缘 */
function resolutionPath(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const mx = (from.x + to.x) / 2
  const my = (from.y + to.y) / 2
  const dx = mx - CX
  const dy = my - CY
  const push = 1.1
  return `M ${from.x} ${from.y} Q ${CX + dx * push} ${CY + dy * push} ${to.x} ${to.y}`
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

export interface HarmonyWheel {
  el: HTMLElement
  /** 选中节点（浏览/点选的和弦）；null 清除 */
  setSelected(sel: WheelChord | null): void
  /** 弹奏识别命中的节点；null 清除 */
  setPlayed(sel: WheelChord | null): void
}

export function buildHarmonyWheel(onPick: (sel: WheelChord) => void): HarmonyWheel {
  const nodeByKey = new Map<string, SVGGElement>()
  /** 解决走线：键 `${root}/7` → 目标扇区序（起点 = 该属七节点） */
  const resLinks = new Map<string, SVGPathElement>()
  /** 关系大小调走线：键 `${root}/rel` */
  const relLinks = new Map<string, SVGLineElement>()

  const linksG = svgEl('g', { class: 'hw__links' })
  const nodesG = svgEl('g', { class: 'hw__nodes' })

  // —— 节点（先建，坐标供走线引用） ——
  const posByKey = new Map<string, { x: number; y: number }>()
  for (let i = 0; i < SECTORS.length; i++) {
    const angle = sectorAngle(i)
    for (const quality of ['major', 'dominant7', 'minor'] as const) {
      const p = polar(RADIUS[quality], angle)
      posByKey.set(`${SECTORS[i].root}/${quality}`, p)
    }
  }

  // —— 常驻走线（暗色；高亮由 class 驱动） ——
  for (let i = 0; i < SECTORS.length; i++) {
    // 属七解决：X7 → 五度圈上一扇区的大三（如 G7 → C）
    const from = posByKey.get(`${SECTORS[i].root}/dominant7`)
    const targetIndex = (i + SECTORS.length - 1) % SECTORS.length
    const to = posByKey.get(`${SECTORS[targetIndex].root}/major`)
    if (from !== undefined && to !== undefined) {
      const path = svgEl('path', {
        class: 'hw__link hw__link--res',
        d: resolutionPath(from, to),
        'marker-end': 'url(#hw-arrow)',
      })
      linksG.append(path)
      resLinks.set(`${SECTORS[i].root}/7`, path)
    }
    // 关系大小调：大三(i) ↔ 小三(i+3)（根音上移小三度，如 C ↔ Am；跨扇区长线，即原书的走线）
    const relA = posByKey.get(`${SECTORS[i].root}/major`)
    const relB = posByKey.get(`${SECTORS[(i + 3) % SECTORS.length].root}/minor`)
    if (relA !== undefined && relB !== undefined) {
      const line = svgEl('line', {
        class: 'hw__link hw__link--rel',
        x1: String(relA.x),
        y1: String(relA.y),
        x2: String(relB.x),
        y2: String(relB.y),
      })
      linksG.append(line)
      relLinks.set(`${SECTORS[i].root}/rel`, line)
    }
  }

  // —— 节点绘制 ——
  for (let i = 0; i < SECTORS.length; i++) {
    const { root, label } = SECTORS[i]
    const angle = sectorAngle(i)
    for (const quality of ['major', 'dominant7', 'minor'] as const) {
      const p = polar(RADIUS[quality], angle)
      const key = `${root}/${quality}`
      const g = svgEl('g', {
        class: `hw__node hw__node--${quality}`,
        'data-root': root,
        'data-quality': quality,
        role: 'button',
      })
      // 命中区比可见圆大一圈，触摸好点
      g.append(
        svgEl('circle', {
          class: 'hw__hit',
          cx: String(p.x),
          cy: String(p.y),
          r: String(NODE_R[quality] + 9),
        }),
      )
      g.append(
        svgEl('circle', {
          class: 'hw__circle',
          cx: String(p.x),
          cy: String(p.y),
          r: String(NODE_R[quality]),
        }),
      )
      g.append(
        svgEl(
          'text',
          {
            class: 'hw__label',
            x: String(p.x),
            y: String(p.y),
            'text-anchor': 'middle',
            'dominant-baseline': 'central',
          },
          `${label}${QUALITY_SUFFIX[quality]}`,
        ),
      )
      g.addEventListener('pointerdown', (e) => e.preventDefault())
      g.addEventListener('click', () => onPick({ root, quality }))
      nodesG.append(g)
      nodeByKey.set(key, g)
    }
  }

  const svg = svgEl(
    'svg',
    { class: 'hw__svg', viewBox: `0 0 ${VIEW} ${VIEW}`, 'aria-hidden': 'false' },
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

  const root = el(
    'div',
    { class: 'hw' },
    el(
      'div',
      { class: 'hw__legend' },
      el('span', { class: 'hw__legend-item hw__legend-item--major' }, '大三'),
      el('span', { class: 'hw__legend-item hw__legend-item--dominant7' }, '属七'),
      el('span', { class: 'hw__legend-item hw__legend-item--minor' }, '小三'),
      el('span', { class: 'hw__legend-hint' }, '点节点切换和弦 · 弹琴实时定位'),
    ),
    svg,
  )

  const highlight = (sel: WheelChord | null, cls: 'is-selected' | 'is-played'): void => {
    for (const g of nodeByKey.values()) g.classList.remove(cls)
    if (sel === null) return
    nodeByKey.get(`${sel.root}/${sel.quality}`)?.classList.add(cls)
  }

  /** 点亮经过 sel 的走线：属七看它出发的解决线；大三/小三看关系线；大三再看指向它的解决线 */
  const indexOfRoot = new Map(SECTORS.map((s, i) => [s.root, i]))
  const highlightLinks = (sel: WheelChord | null, cls: string): void => {
    for (const link of [...resLinks.values(), ...relLinks.values()]) link.classList.remove(cls)
    if (sel === null) return
    if (sel.quality === 'dominant7') {
      resLinks.get(`${sel.root}/7`)?.classList.add(cls)
      return
    }
    const i = indexOfRoot.get(sel.root) ?? 0
    // 关系线以大三所在扇区为键：小三的关系线挂在 (i−3) 扇区
    const relRoot =
      sel.quality === 'major' ? sel.root : SECTORS[(i + SECTORS.length - 3) % SECTORS.length].root
    relLinks.get(`${relRoot}/rel`)?.classList.add(cls)
    if (sel.quality === 'major') {
      const domRoot = SECTORS[(i + 1) % SECTORS.length].root
      resLinks.get(`${domRoot}/7`)?.classList.add(cls)
    }
  }

  return {
    el: root,
    setSelected(sel) {
      highlight(sel, 'is-selected')
      highlightLinks(sel, 'hw__link--from-selected')
    },
    setPlayed(sel) {
      highlight(sel, 'is-played')
      highlightLinks(sel, 'hw__link--from-played')
    },
  }
}
