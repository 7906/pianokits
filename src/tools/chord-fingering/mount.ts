import {
  CHORD_QUALITIES,
  FIFTHS_ORDER,
  detectChord,
  detectDim7Roots,
  getChordNotes,
  getChordQuality,
  parseChordSymbol,
  ChordParseError,
  noteNameToPc,
  type ChordQualityId,
  type NoteName,
} from '../../core/chords'
import { getChordFingering, type Hand } from '../../core/fingering'
import { ChordPracticeEngine } from '../../core/practice/chord-practice'
import { midiNoteName } from '../../core/midi/note-name'
import { el } from '../../ui/dom'
import { buildChordKeyboard, type ChordKeyboard, type ExamKeyState } from './chord-keyboard'
import { buildHarmonyWheel, type WheelChord } from './harmony-wheel'
import { midiStatusText, startMidiInput } from './midi-input'

/**
 * 「和弦指法」工具页（规格 §9 MVP + 跟弹练习 + 和弦魔方）：
 * 四种模式——
 * - 浏览：任选和弦查看指法；屏幕键盘可点按试听，联琴后弹的键实时点亮；
 * - 魔方：和声轮视图——五度圈 12 扇区 × 大三/属七/小三三层节点，点节点切换和弦，
 *   弹琴（MIDI / 屏幕键盘）经 detectChord 实时点亮所弹和弦的节点，属七→主、
 *   关系大小调走线随选中/弹奏点亮（源自《Illustrated Harmony》的图形化思路）；
 * - 跟弹：目标和弦与其指法常亮显示，在琴上（或屏幕键盘）照着弹，弹的键实时点亮、
 *   弹错标红、弹对闪绿并自动下一题——「看着目标找键」的主动训练；
 * - 考试：盲答（不显示目标），可用「提示」临时亮出目标；判定与跟弹同一引擎。
 * MIDI 经适配器汇入同一练习引擎（MidiInput → Practice Engine），本文件只做展示与输入适配。
 *
 * 触摸适配：控件为大号 chip、键盘容器关闭触摸滚动（touch-action: none），
 * pointer capture 保证滑出键面也能抬起；优先横屏布局（样式见 style.css）。
 */

const ROOT_LABELS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const
const QUALITY_LABELS: Readonly<Record<ChordQualityId, string>> = {
  major: '大三',
  minor: '小三',
  diminished: '减三',
  augmented: '增三',
  sus2: '挂二',
  sus4: '挂四',
  dominant7: '属七',
  major7: '大七',
  minor7: '小七',
  halfDiminished7: '半减七',
  diminished7: '减七',
}
const INVERSION_NAMES = ['原位', '第一转位', '第二转位', '第三转位'] as const
const HAND_NAMES: Readonly<Record<Hand, string>> = { right: '右手', left: '左手' }
const MIN_TRANSPOSE = -11
const MAX_TRANSPOSE = 11

type ToolMode = 'browse' | 'wheel' | 'guided' | 'exam'
/** 魔方子视图：转调图（原书图 2）/ 走线图（原书图 1） */
type WheelView = 'functional' | 'voiceleading'

/** 魔方图支持的质量（与 detectChord / 和声轮节点一致） */
const WHEEL_QUALITIES: readonly ChordQualityId[] = ['major', 'minor', 'dominant7', 'diminished7']

/** 根音拼写折到五度圈扇区拼写（C#→Db、D#→Eb…），与魔方图节点一致 */
function wheelRootName(root: NoteName): NoteName {
  const pc = noteNameToPc(root)
  return FIFTHS_ORDER.find((r) => noteNameToPc(r) === pc) ?? root
}

interface ToolState {
  root: NoteName
  quality: ChordQualityId
  inversion: number
  hand: Hand
  profileId: 'standard' | 'small-hand'
  transpose: number
  mode: ToolMode
  wheelView: WheelView
}

interface ExamRun {
  root: NoteName
  quality: ChordQualityId
  inversion: number
  hand: Hand
  /** 目标音高（已含移调） */
  pitches: readonly number[]
  fingers: readonly number[]
}

/** 随机出题：12 根音 × 全部质量 × 有效转位 × 当前手别；音高含当前移调 */
function nextExamQuestion(hand: Hand, transpose: number): ExamRun {
  const root = ROOT_LABELS[Math.floor(Math.random() * ROOT_LABELS.length)]
  const quality = CHORD_QUALITIES[Math.floor(Math.random() * CHORD_QUALITIES.length)]
  const inversion = Math.floor(Math.random() * (quality.supportedInversions + 1))
  const notes = getChordNotes(root, quality, inversion)
  const fingering = getChordFingering({ root, quality: quality.id, inversion, hand })
  return {
    root,
    quality: quality.id,
    inversion,
    hand,
    pitches: notes.pitches.map((p) => p + transpose),
    fingers: fingering.fingers,
  }
}

export function mountChordFingering(host: HTMLElement): () => void {
  const state: ToolState = {
    root: 'C',
    quality: 'major',
    inversion: 0,
    hand: 'right',
    profileId: 'standard',
    transpose: 0,
    mode: 'browse',
    wheelView: 'functional',
  }

  const engine = new ChordPracticeEngine()
  const keyboard: ChordKeyboard = buildChordKeyboard()

  // —— 练习会话 ——
  let question: ExamRun | null = null
  let streak = 0
  let total = 0
  let nextTimer: number | undefined
  let hintOn = false // 考试模式的「提示」：临时亮出目标与指法
  const virtualHeld = new Set<number>()
  let midiHeld: Set<number> = new Set()
  let stopMidi: (() => void) | null = null

  // —— DOM 骨架 ——
  const searchInput = el('input', {
    class: 'chordf__search',
    type: 'text',
    placeholder: '输入和弦，如 Cm7b5 / Bbmaj7 / F#m7b5',
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
  })
  const applySearch = (): void => {
    const text = searchInput.value.trim()
    if (text === '') return
    try {
      const parsed = parseChordSymbol(text)
      state.root = parsed.root
      state.quality = parsed.quality
      state.inversion = 0
      setFeedback(null)
      if (isPracticing()) exitPractice()
      renderAll()
    } catch (e) {
      if (e instanceof ChordParseError) {
        setFeedback(
          `无法识别 ${JSON.stringify(e.symbol)}：支持 C / Cm / C7 / Cmaj7 / Cm7b5 / Csus2 等`,
        )
      }
    }
  }
  searchInput.addEventListener('keydown', (e) => {
    if (e instanceof KeyboardEvent && e.key === 'Enter') applySearch()
  })
  const searchBtn = el('button', { class: 'chordf__go', onclick: applySearch }, '查找')

  const rootRow = el('div', { class: 'chordf__row', role: 'group', 'aria-label': '根音' })
  const qualityRow = el('div', { class: 'chordf__row', role: 'group', 'aria-label': '和弦类型' })
  const inversionRow = el('div', { class: 'chordf__row', role: 'group', 'aria-label': '转位' })

  const handSeg = makeSeg<Hand>(
    ['right', 'left'] as const,
    (h) => HAND_NAMES[h],
    (h) => {
      if (state.hand === h) return
      state.hand = h
      if (isPracticing()) ask() // 手别变化：换一道新题
      renderAll()
    },
  )
  const profileSeg = makeSeg<'standard' | 'small-hand'>(
    ['standard', 'small-hand'] as const,
    (p) => (p === 'standard' ? '标准手' : '小手'),
    (p) => {
      if (state.profileId === p) return
      state.profileId = p
      renderAll()
    },
  )
  const modeSeg = makeSeg<ToolMode>(
    ['browse', 'wheel', 'guided', 'exam'] as const,
    (m) => (m === 'browse' ? '浏览' : m === 'wheel' ? '魔方' : m === 'guided' ? '跟弹' : '考试'),
    (m) => {
      if (state.mode === m) return
      if (m === 'browse') exitPractice()
      else if (m === 'wheel') enterWheel()
      else startPractice(m)
    },
  )

  // 和弦魔方：点节点切换和弦（减七节点也可点），渲染由 renderWheel 驱动
  const pickChord = (sel: WheelChord): void => {
    state.root = sel.root
    state.quality = sel.quality
    state.inversion = 0
    setFeedback(null)
    renderAll()
  }
  const wheelFunctional = buildHarmonyWheel('functional', pickChord)
  const wheelVoiceleading = buildHarmonyWheel('voiceleading', pickChord)
  const viewSeg = makeSeg<WheelView>(
    ['functional', 'voiceleading'] as const,
    (v) => (v === 'functional' ? '转调图' : '走线图'),
    (v) => {
      if (state.wheelView === v) return
      state.wheelView = v
      renderAll()
    },
  )
  const wheelWrap = el(
    'div',
    { class: 'chordf__wheelwrap', hidden: true },
    viewSeg.el,
    wheelFunctional.el,
    wheelVoiceleading.el,
  )

  const transposeLabel = el('span', { class: 'chordf__transpose-val' }, '0')
  const shiftTranspose = (d: number): void => {
    const next = state.transpose + d
    if (next < MIN_TRANSPOSE || next > MAX_TRANSPOSE) return
    state.transpose = next
    if (isPracticing() && question !== null) {
      // 题目音高同步平移（指法不变）
      question = { ...question, pitches: question.pitches.map((p) => p + d) }
      engine.setQuestion(question.pitches)
      renderPractice()
    }
    renderAll()
  }
  const transposeDown = el(
    'button',
    { class: 'chordf__step', onclick: () => shiftTranspose(-1) },
    '−',
  )
  const transposeUp = el('button', { class: 'chordf__step', onclick: () => shiftTranspose(1) }, '+')
  const transposeReset = el(
    'button',
    {
      class: 'chordf__reset',
      title: '重置移调',
      onclick: () => {
        if (state.transpose !== 0) shiftTranspose(-state.transpose)
      },
    },
    '重置',
  )

  // MIDI 连接：常驻面板（浏览/跟弹/考试都可见可用），状态文字给出可执行的下一步指引
  const midiBtn = el('button', { class: 'chordf__exam-btn', onclick: toggleMidi }, '连接 MIDI 键盘')
  const midiStatus = el('span', { class: 'chordf__midi-status' })
  const midiGroup = el(
    'div',
    { class: 'chordf__group' },
    el('span', { class: 'chordf__grouplabel' }, '联琴'),
    midiBtn,
    midiStatus,
  )

  const headlineMain = el('div', { class: 'chordf__headline-main' })
  const headlineSub = el('div', { class: 'chordf__headline-sub' })
  const headline = el('div', { class: 'chordf__headline' }, headlineMain, headlineSub)

  const feedback = el('div', { class: 'chordf__feedback', hidden: true })
  function setFeedback(text: string | null): void {
    feedback.textContent = text ?? ''
    feedback.hidden = text === null
  }

  const examStreak = el('span', { class: 'chordf__streak' })
  const hintBtn = el(
    'button',
    {
      class: 'chordf__exam-btn',
      title: '临时显示目标键位与指法',
      onclick: () => {
        hintOn = !hintOn
        hintBtn.classList.toggle('is-active', hintOn)
        renderPractice()
      },
    },
    '提示',
  )
  const nextBtn = el(
    'button',
    {
      class: 'chordf__exam-btn',
      onclick: () => {
        if (isPracticing() && !engine.state.solved) streak = 0 // 未答完跳过：连对清零
        ask()
      },
    },
    '下一题',
  )
  const exitBtn = el(
    'button',
    { class: 'chordf__exam-btn chordf__exam-btn--ghost', onclick: () => exitPractice() },
    '退出练习',
  )
  const examBar = el(
    'div',
    { class: 'chordf__exambar', hidden: true },
    examStreak,
    nextBtn,
    hintBtn,
    exitBtn,
  )

  const inner = el(
    'div',
    { class: 'chordf__inner' },
    el(
      'div',
      { class: 'chordf__panel' },
      el('div', { class: 'chordf__row chordf__search-row' }, searchInput, searchBtn),
      rootRow,
      qualityRow,
      el('div', { class: 'chordf__row' }, inversionRow, handSeg.el, profileSeg.el),
      el(
        'div',
        { class: 'chordf__row' },
        el(
          'div',
          { class: 'chordf__group' },
          el('span', { class: 'chordf__grouplabel' }, '移调'),
          transposeDown,
          transposeLabel,
          transposeUp,
          transposeReset,
        ),
        modeSeg.el,
        midiGroup,
      ),
    ),
    headline,
    feedback,
    examBar,
    wheelWrap,
    keyboard.el,
  )
  host.append(el('div', { class: 'chordf' }, inner))

  // —— 练习引擎接线：虚拟键盘 + MIDI → 同一判定 ——
  const offKeyInput = keyboard.onKeyInput((pitch, down) => {
    if (down) virtualHeld.add(pitch)
    else virtualHeld.delete(pitch)
    syncHeld()
  })
  const offSolved = engine.onSolved(() => {
    const q = question
    if (!isPracticing() || q === null) return
    streak += 1
    total += 1
    // 解答成立：目标键闪绿并亮出指法
    const lit = new Map<number, { state: ExamKeyState; alpha: number; glow: number }>()
    for (const p of q.pitches) lit.set(p, { state: 'solved', alpha: 1, glow: 0.5 })
    keyboard.paint(lit)
    keyboard.setBadges(new Map(q.pitches.map((p, i) => [p, q.fingers[i]])))
    renderExamBar()
    nextTimer = window.setTimeout(() => ask(), 900)
  })

  /** 是否处于出题练习（跟弹 / 考试）；浏览与魔方不判题 */
  function isPracticing(): boolean {
    return state.mode === 'guided' || state.mode === 'exam'
  }

  function syncHeld(): void {
    engine.setHeld(new Set([...virtualHeld, ...midiHeld]))
    if (state.mode === 'browse') renderBrowse()
    else if (state.mode === 'wheel') renderWheel()
    else renderPractice()
  }

  function startPractice(mode: 'guided' | 'exam'): void {
    state.mode = mode
    streak = 0
    total = 0
    hintOn = false
    virtualHeld.clear()
    engine.releaseAll()
    examBar.hidden = false
    hintBtn.hidden = mode !== 'exam'
    ask()
    renderAll()
  }

  /** 进入魔方模式：无题目，键盘照常显示当前选中和弦，弹奏实时定位到轮上 */
  function enterWheel(): void {
    if (nextTimer !== undefined) {
      clearTimeout(nextTimer)
      nextTimer = undefined
    }
    state.mode = 'wheel'
    question = null
    hintOn = false
    engine.reset()
    examBar.hidden = true
    renderAll()
  }

  function ask(): void {
    if (nextTimer !== undefined) {
      clearTimeout(nextTimer)
      nextTimer = undefined
    }
    question = nextExamQuestion(state.hand, state.transpose)
    hintOn = false
    hintBtn.classList.remove('is-active')
    virtualHeld.clear()
    engine.setQuestion(question.pitches)
    renderPractice()
    renderExamBar()
  }

  function exitPractice(): void {
    if (nextTimer !== undefined) {
      clearTimeout(nextTimer)
      nextTimer = undefined
    }
    state.mode = 'browse'
    question = null
    hintOn = false
    engine.reset()
    virtualHeld.clear()
    examBar.hidden = true
    renderAll()
  }

  function toggleMidi(): void {
    if (stopMidi !== null) {
      stopMidi()
      stopMidi = null
      midiHeld = new Set()
      midiBtn.textContent = '连接 MIDI 键盘'
      midiStatus.textContent = ''
      syncHeld()
      return
    }
    midiBtn.textContent = '断开 MIDI'
    midiStatus.textContent = '连接中…'
    stopMidi = startMidiInput((ev) => {
      midiHeld = new Set(ev.held)
      midiStatus.textContent = midiStatusText(ev.status, ev.detail, ev.inputs)
      if (ev.status === 'error') {
        // 连接失败：回收按钮态（软超时保持等待，不自动断开）
        stopMidi?.()
        stopMidi = null
        midiBtn.textContent = '连接 MIDI 键盘'
      }
      syncHeld()
    })
  }

  function renderExamBar(): void {
    examStreak.textContent = `已答 ${total} 题 · 连对 ${streak}`
  }

  // —— 渲染 ——
  function chip(label: string, active: boolean, onclick: () => void, title?: string): HTMLElement {
    return el(
      'button',
      { class: `chordf__chip${active ? ' is-active' : ''}`, onclick, title },
      label,
    )
  }

  /** 选择根音 / 类型 / 转位：练习中退出练习，其余模式就地刷新 */
  function pickAndExitPractice(apply: () => void): () => void {
    return () => {
      apply()
      if (isPracticing()) exitPractice()
      else renderAll()
    }
  }

  function renderRows(): void {
    const rootPc = noteNameToPc(state.root)
    rootRow.replaceChildren(
      ...ROOT_LABELS.map((n) =>
        chip(
          n,
          noteNameToPc(n) === rootPc,
          pickAndExitPractice(() => (state.root = n)),
        ),
      ),
    )
    qualityRow.replaceChildren(
      ...CHORD_QUALITIES.map((q) =>
        chip(
          `${QUALITY_LABELS[q.id]}${q.symbols[0] === '' ? '' : ` ${q.symbols[0]}`}`,
          state.quality === q.id,
          pickAndExitPractice(() => {
            state.quality = q.id
            if (state.inversion > q.supportedInversions) state.inversion = 0
          }),
        ),
      ),
    )
    const q = getChordQuality(state.quality)
    inversionRow.replaceChildren(
      el('span', { class: 'chordf__grouplabel' }, '转位'),
      ...Array.from({ length: q.supportedInversions + 1 }, (_, i) =>
        chip(
          INVERSION_NAMES[i],
          state.inversion === i,
          pickAndExitPractice(() => (state.inversion = i)),
        ),
      ),
    )
    handSeg.set(state.hand)
    profileSeg.set(state.profileId)
    modeSeg.set(state.mode)
    transposeLabel.textContent =
      state.transpose === 0 ? '0' : `${state.transpose > 0 ? '+' : ''}${state.transpose}`
    transposeDown.toggleAttribute('disabled', state.transpose <= MIN_TRANSPOSE)
    transposeUp.toggleAttribute('disabled', state.transpose >= MAX_TRANSPOSE)
  }

  function chordSymbol(root: NoteName, quality: ChordQualityId): string {
    return `${root}${getChordQuality(quality).symbols[0]}`
  }

  function renderBrowse(): void {
    const notes = getChordNotes(state.root, state.quality, state.inversion)
    const pitches = notes.pitches.map((p) => p + state.transpose)
    const fingering = getChordFingering({
      root: state.root,
      quality: state.quality,
      inversion: state.inversion,
      hand: state.hand,
      profile: state.profileId,
    })

    headlineMain.textContent = chordSymbol(state.root, state.quality)
    headlineSub.textContent = [
      INVERSION_NAMES[state.inversion],
      HAND_NAMES[state.hand],
      `指法 ${fingering.fingers.join('-')}`,
      `音符 ${pitches.map((p, i) => `${midiNoteName(p)}(${notes.degrees[i]})`).join(' ')}`,
      state.transpose !== 0 ? `移调 ${state.transpose > 0 ? '+' : ''}${state.transpose}` : '',
    ]
      .filter(Boolean)
      .join(' · ')

    // 涉及音符半透明高亮 + 指法数字徽标；用户按下（屏幕或 MIDI 琴）：和弦内变实、按错标红
    const lit = new Map<number, { state: ExamKeyState; alpha: number; glow: number }>()
    for (const p of pitches) lit.set(p, { state: 'held', alpha: 0.45, glow: 0 })
    for (const p of [...virtualHeld, ...midiHeld]) {
      lit.set(
        p,
        lit.has(p)
          ? { state: 'solved', alpha: 0.95, glow: 0.3 }
          : { state: 'wrong', alpha: 0.95, glow: 0.4 },
      )
    }
    keyboard.paint(lit)
    keyboard.setBadges(new Map(pitches.map((p, i) => [p, fingering.fingers[i]])))
  }

  /** 跟弹 / 考试共用渲染；showTarget = 目标键位与指法是否可见（跟弹恒显，考试看提示） */
  function renderPractice(): void {
    const q = question
    if (q === null || state.mode === 'browse') return
    const st = engine.state
    headlineMain.textContent = `请弹奏：${chordSymbol(q.root, q.quality)}`
    headlineSub.textContent = [
      INVERSION_NAMES[q.inversion],
      HAND_NAMES[q.hand],
      state.transpose !== 0 ? `移调 ${state.transpose > 0 ? '+' : ''}${state.transpose}` : '',
      state.mode === 'guided' ? '照着亮键弹，弹对自动下一题' : '凭记忆弹；「提示」可临时亮出键位',
    ]
      .filter(Boolean)
      .join(' · ')

    if (st.solved) return // onSolved 已画绿色与指法

    const showTarget = state.mode === 'guided' || hintOn
    const lit = new Map<number, { state: ExamKeyState; alpha: number; glow: number }>()
    if (showTarget) {
      for (const p of q.pitches) {
        if (!st.held.has(p)) lit.set(p, { state: 'held', alpha: 0.35, glow: 0 })
      }
    }
    for (const p of st.held) lit.set(p, { state: 'held', alpha: 1, glow: 0.3 })
    for (const p of st.wrong) lit.set(p, { state: 'wrong', alpha: 1, glow: 0.6 })
    keyboard.paint(lit)
    keyboard.setBadges(showTarget ? new Map(q.pitches.map((p, i) => [p, q.fingers[i]])) : new Map())
  }

  /** 魔方模式：键盘照常显示选中和弦与弹奏回显；图上高亮选中和弹奏识别的节点 */
  function renderWheel(): void {
    const notes = getChordNotes(state.root, state.quality, state.inversion)
    const pitches = notes.pitches.map((p) => p + state.transpose)
    const fingering = getChordFingering({
      root: state.root,
      quality: state.quality,
      inversion: state.inversion,
      hand: state.hand,
      profile: state.profileId,
    })

    const held = new Set([...virtualHeld, ...midiHeld])
    const detected = detectChord(held)
    // 减七等音多解：一个减七音集点亮全部 4 个 ° 节点（转调枢纽的教学点）
    const played: WheelChord[] =
      detected === null
        ? []
        : detected.quality === 'diminished7'
          ? detectDim7Roots(held).map((r) => ({ root: r, quality: 'diminished7' as const }))
          : [{ root: detected.root, quality: detected.quality }]
    headlineMain.textContent = chordSymbol(state.root, state.quality)
    headlineSub.textContent = [
      state.wheelView === 'functional' ? '转调图' : '走线图',
      INVERSION_NAMES[state.inversion],
      HAND_NAMES[state.hand],
      `指法 ${fingering.fingers.join('-')}`,
      detected !== null
        ? `弹奏识别：${chordSymbol(detected.root, detected.quality)}${
            detected.quality === 'diminished7' ? '（等音 4 解）' : ''
          }`
        : '弹琴实时定位（需 3–4 个音）',
    ]
      .filter(Boolean)
      .join(' · ')

    const lit = new Map<number, { state: ExamKeyState; alpha: number; glow: number }>()
    for (const p of pitches) lit.set(p, { state: 'held', alpha: 0.45, glow: 0 })
    for (const p of held) {
      lit.set(
        p,
        lit.has(p)
          ? { state: 'solved', alpha: 0.95, glow: 0.3 }
          : { state: 'wrong', alpha: 0.95, glow: 0.4 },
      )
    }
    keyboard.paint(lit)
    keyboard.setBadges(new Map(pitches.map((p, i) => [p, fingering.fingers[i]])))

    // 图上节点：选中（琥珀）+ 弹奏识别（绿）；根音拼写折到五度圈扇区（C# → Db）
    const wheelSel = WHEEL_QUALITIES.includes(state.quality)
      ? { root: wheelRootName(state.root), quality: state.quality as WheelChord['quality'] }
      : null
    const playedList = played.map((c) => ({ ...c, root: wheelRootName(c.root) }))
    wheelFunctional.setSelected(wheelSel)
    wheelFunctional.setPlayed(playedList)
    wheelVoiceleading.setSelected(wheelSel)
    wheelVoiceleading.setPlayed(playedList)
  }

  function renderAll(): void {
    renderRows()
    wheelWrap.hidden = state.mode !== 'wheel'
    wheelFunctional.el.hidden = state.wheelView !== 'functional'
    wheelVoiceleading.el.hidden = state.wheelView !== 'voiceleading'
    viewSeg.set(state.wheelView)
    if (state.mode === 'browse') renderBrowse()
    else if (state.mode === 'wheel') renderWheel()
    else renderPractice()
  }

  renderAll()

  return () => {
    offKeyInput()
    offSolved()
    stopMidi?.()
    if (nextTimer !== undefined) clearTimeout(nextTimer)
    keyboard.clear()
  }
}

/** 分段控件（单选 chip 组） */
function makeSeg<T extends string>(
  values: readonly T[],
  label: (v: T) => string,
  onPick: (v: T) => void,
): { el: HTMLElement; set: (v: T) => void } {
  const buttons = new Map<T, HTMLElement>()
  const root = el('div', { class: 'chordf__seg', role: 'group' })
  for (const v of values) {
    const b = el('button', { class: 'chordf__chip', onclick: () => onPick(v) }, label(v))
    buttons.set(v, b)
    root.append(b)
  }
  return {
    el: root,
    set(v) {
      for (const [val, b] of buttons) b.classList.toggle('is-active', val === v)
    },
  }
}
