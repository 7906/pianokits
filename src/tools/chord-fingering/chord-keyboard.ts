import { el } from '../../ui/dom'
import { buildPiano, keyGeometry, BLACK_PCS } from '../../ui/piano-keyboard'

/**
 * 「和弦指法」工具的 88 键键盘视图：在共享的 buildPiano 组件之上叠加
 * - 指法数字徽标（绝对定位层，left 用百分比 = keyGeometry 公式的归一化结果，
 *   随键盘宽度自适应，无需监听 resize）；
 * - 考试点亮态（按住 = 琥珀 / 按错 = 红 / 解答 = 绿，经 setLit 逐键着色）；
 * - 虚拟键盘输入（pointer 按下 / 抬起，支持多点触摸）。
 * 不修改 buildPiano 本身，符合「新增功能独立于现有 UI 实现」的约束。
 */

/** 徽标在键上的纵向位置（键盘高度的百分比）：白键贴底缘，黑键在其下段 */
const BADGE_TOP_WHITE = 76 // %
const BADGE_TOP_BLACK = 40 // %

export type ExamKeyState = 'held' | 'wrong' | 'solved'

/** 点亮色（RGB），与全局语义色一致（琥珀 / 危险红 / 成功绿） */
const COLORS: Readonly<Record<ExamKeyState, readonly [number, number, number]>> = {
  held: [217, 164, 91],
  wrong: [224, 105, 94],
  solved: [127, 178, 133],
}

/** 逐键点亮描述：state 决定色相，alpha 控制强度（浏览态半透明、考试态全亮） */
export interface KeyPaint {
  state: ExamKeyState
  alpha?: number
  glow?: number
}

export interface ChordKeyboard {
  el: HTMLElement
  /** 显示指法徽标：pitch → 手指编号；空 Map 隐藏全部徽标 */
  setBadges(badges: ReadonlyMap<number, number>): void
  /** 常规按下态（浏览模式点按反馈） */
  setPressed(pitches: readonly number[]): void
  /** 逐键点亮：Map 之外的键恢复常态 */
  paint(lit: ReadonlyMap<number, KeyPaint>): void
  /** 清除全部点亮 / 徽标 / 按下态 */
  clear(): void
  /** 订阅虚拟键盘输入：down = true 按下 / false 抬起；返回取消订阅函数 */
  onKeyInput(handler: (pitch: number, down: boolean) => void): () => void
}

export function buildChordKeyboard(): ChordKeyboard {
  const piano = buildPiano()
  const badgeLayer = el('div', { class: 'chord-kb__badges', 'aria-hidden': 'true' })
  const root = el('div', { class: 'chord-kb' }, piano.el, badgeLayer)

  const keyEls = new Map<number, HTMLElement>()
  for (const keyEl of piano.el.querySelectorAll<HTMLElement>('[data-pitch]')) {
    const pitch = Number(keyEl.dataset.pitch)
    if (Number.isInteger(pitch)) keyEls.set(pitch, keyEl)
  }

  return {
    el: root,

    setBadges(badges) {
      badgeLayer.replaceChildren()
      if (badges.size === 0) return
      // 白键宽比例：keyGeometry 需要 88 键总宽，归一化成百分比定位（与 CSS 几何公式一致）
      const TOTAL = 1000 // 任意基准宽度（结果只取比例）
      for (const [pitch, finger] of badges) {
        const keyEl = keyEls.get(pitch)
        if (keyEl === undefined) continue
        const g = keyGeometry(TOTAL, pitch)
        const cxPct = ((g.left + g.width / 2) / TOTAL) * 100
        const topPct = BLACK_PCS.has(pitch % 12) ? BADGE_TOP_BLACK : BADGE_TOP_WHITE
        badgeLayer.append(
          el(
            'span',
            {
              class: 'chord-kb__badge',
              style: { left: `${cxPct}%`, top: `${topPct}%` },
            },
            String(finger),
          ),
        )
      }
    },

    setPressed(pitches) {
      piano.setPressed(pitches)
    },

    paint(states) {
      const lit = new Map<
        number,
        { color: readonly [number, number, number]; alpha: number; glow: number }
      >()
      for (const [pitch, s] of states) {
        lit.set(pitch, {
          color: COLORS[s.state],
          alpha: Math.max(0, Math.min(1, s.alpha ?? 1)),
          glow: s.glow ?? (s.state === 'wrong' ? 0.6 : 0.25),
        })
      }
      piano.setLit(lit)
    },

    clear() {
      badgeLayer.replaceChildren()
      piano.setLit(new Map())
      piano.setPressed([])
    },

    onKeyInput(handler) {
      const handlers: { keyEl: HTMLElement; pitch: number; off: () => void }[] = []
      /** 触摸 / 手写笔正在按住的键（抬起即释放） */
      const touchHeld = new Set<number>()
      /** 鼠标点击锁定的键（再点一次释放）——鼠标只有一个指针，无法同时按住多键 */
      const mouseLatched = new Set<number>()
      const send = (pitch: number, down: boolean): void => handler(pitch, down)
      for (const [pitch, keyEl] of keyEls) {
        const down = (e: PointerEvent): void => {
          e.preventDefault()
          // 捕获指针：触摸滑出键面也能收到抬起事件，避免“按键卡住”
          try {
            keyEl.setPointerCapture(e.pointerId)
          } catch {
            /* 指针已失效时忽略 */
          }
          if (e.pointerType === 'mouse') {
            // 鼠标点击 = 锁定/解锁，逐键点按可叠出多音和弦
            const latched = !mouseLatched.has(pitch)
            if (latched) mouseLatched.add(pitch)
            else mouseLatched.delete(pitch)
            send(pitch, latched)
          } else if (!touchHeld.has(pitch)) {
            touchHeld.add(pitch)
            send(pitch, true)
          }
        }
        const up = (): void => {
          if (touchHeld.delete(pitch)) send(pitch, false)
        }
        keyEl.addEventListener('pointerdown', down)
        keyEl.addEventListener('pointerup', up)
        keyEl.addEventListener('pointercancel', up)
        handlers.push({
          keyEl,
          pitch,
          off: () => {
            keyEl.removeEventListener('pointerdown', down)
            keyEl.removeEventListener('pointerup', up)
            keyEl.removeEventListener('pointercancel', up)
          },
        })
      }
      return () => {
        for (const h of handlers) h.off()
        handlers.length = 0
      }
    },
  }
}
