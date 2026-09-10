/**
 * 和弦练习判定引擎（规格 §8）：不依赖 MIDI。虚拟键盘（点击/触摸）与 MIDI 键盘
 * 两种输入源都只向引擎提供「当前按下的音高集合」（`setHeld`），考试判定逻辑
 * 完全复用——之后再接入真实 MIDI 时无需改动判定代码。
 *
 * 判定规则（屏幕出题 → 用户弹奏 → 判定）：
 * - 目标集合（题目）内的按键 = 正确，目标外的按键 = 按错（UI 标红）；
 * - 按住的集合与目标集合完全一致（不多不少）时解答成立（solved）；
 * - `onSolved` 只在「未成立 → 成立」的边沿触发一次，持续按住不重复触发，
 *   松开全部键后重弹可再次触发；
 * - `state` 返回完整快照，外部改动不影响引擎内部状态。
 */

/** 练习引擎当前状态快照（UI 渲染依据） */
export interface ChordPracticeState {
  /** 当前题目（目标音高集合）；null = 未出题 */
  readonly target: ReadonlySet<number> | null
  /** 当前按住的音高 */
  readonly held: ReadonlySet<number>
  /** 按错的键（held 中不属于 target 的音高） */
  readonly wrong: ReadonlySet<number>
  /** 本轮作答是否已成立（held 与 target 完全一致） */
  readonly solved: boolean
}

export type ChordPracticeListener = () => void

export class ChordPracticeEngine {
  private target: ReadonlySet<number> | null = null
  private held = new Set<number>()
  private wrong = new Set<number>()
  private solved = false
  private readonly listeners = new Set<ChordPracticeListener>()

  get state(): ChordPracticeState {
    return {
      target: this.target === null ? null : new Set(this.target),
      held: new Set(this.held),
      wrong: new Set(this.wrong),
      solved: this.solved,
    }
  }

  /** 出题（空集合视为取消题目）；判定状态随之重置 */
  setQuestion(pitches: Iterable<number>): void {
    const t = new Set(pitches)
    this.target = t.size === 0 ? null : t
    this.wrong = new Set()
    this.solved = false
  }

  /**
   * 统一输入接口：虚拟键盘 / MIDI 适配器都调用它推送「当前按下的音高集合」。
   * 引擎不关心来源，只按集合语义判定。
   */
  setHeld(pitches: Iterable<number>): void {
    this.held = new Set(pitches)
    const t = this.target
    this.wrong = new Set(t === null ? [] : [...this.held].filter((p) => !t.has(p)))
    const nowSolved =
      t !== null &&
      this.held.size === t.size &&
      this.wrong.size === 0 &&
      [...t].every((p) => this.held.has(p))
    const edge = nowSolved && !this.solved
    this.solved = nowSolved
    if (edge) for (const l of this.listeners) l()
  }

  /** 清空按住状态（如切换题目 / 工具卸载时） */
  releaseAll(): void {
    this.held = new Set()
    this.wrong = new Set()
    this.solved = false
  }

  /** 取消题目并清空按住状态 */
  reset(): void {
    this.target = null
    this.releaseAll()
  }

  /** 订阅解答成立事件（边沿触发）；返回取消订阅函数 */
  onSolved(listener: ChordPracticeListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}
