import {
  CHORD_QUALITIES,
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
import { midiStatusText, startMidiInput } from './midi-input'

/**
 * 「和弦指法」工具页（规格 §9 MVP）：
 * 和弦搜索 / 根音 / 类型 / 转位 / 左右手 / profile / 88 键显示 / 音符高亮 /
 * 指法数字 / 半音移调 / 虚拟键盘考试模式，以及 MIDI 适配器接入（MidiInput →
 * Practice Engine）。和弦公式与指法规则全部来自 core 模块，本文件只做展示与输入适配。
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
}
const INVERSION_NAMES = ['原位', '第一转位', '第二转位', '第三转位'] as const
const HAND_NAMES: Readonly<Record<Hand, string>> = { right: '右手', left: '左手' }
const MIN_TRANSPOSE = -11
const MAX_TRANSPOSE = 11

interface ToolState {
  root: NoteName
  quality: ChordQualityId
  inversion: number
  hand: Hand
  profileId: 'standard' | 'small-hand'
  transpose: number
  mode: 'browse' | 'exam'
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
  }

  const engine = new ChordPracticeEngine()
  const keyboard: ChordKeyboard = buildChordKeyboard()

  // —— 考试会话 ——
  let question: ExamRun | null = null
  let streak = 0
  let total = 0
  let nextTimer: number | undefined
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
      if (state.mode === 'exam') exitExam()
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
      if (state.mode === 'exam') ask() // 手别变化：换一道新题
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
  const modeSeg = makeSeg<'browse' | 'exam'>(
    ['browse', 'exam'] as const,
    (m) => (m === 'browse' ? '浏览' : '考试'),
    (m) => {
      if (state.mode === m) return
      if (m === 'exam') startExam()
      else exitExam()
    },
  )

  const transposeLabel = el('span', { class: 'chordf__transpose-val' }, '0')
  const shiftTranspose = (d: number): void => {
    const next = state.transpose + d
    if (next < MIN_TRANSPOSE || next > MAX_TRANSPOSE) return
    state.transpose = next
    if (state.mode === 'exam' && question !== null) {
      // 题目音高同步平移（指法不变）
      question = { ...question, pitches: question.pitches.map((p) => p + d) }
      engine.setQuestion(question.pitches)
      renderExam()
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

  const headlineMain = el('div', { class: 'chordf__headline-main' })
  const headlineSub = el('div', { class: 'chordf__headline-sub' })
  const headline = el('div', { class: 'chordf__headline' }, headlineMain, headlineSub)

  const feedback = el('div', { class: 'chordf__feedback', hidden: true })
  function setFeedback(text: string | null): void {
    feedback.textContent = text ?? ''
    feedback.hidden = text === null
  }

  const examStreak = el('span', { class: 'chordf__streak' })
  const nextBtn = el(
    'button',
    {
      class: 'chordf__exam-btn',
      onclick: () => {
        if (state.mode === 'exam' && !engine.state.solved) streak = 0 // 未答完跳过：连对清零
        ask()
      },
    },
    '下一题',
  )
  const exitBtn = el(
    'button',
    { class: 'chordf__exam-btn chordf__exam-btn--ghost', onclick: () => exitExam() },
    '退出考试',
  )
  const midiBtn = el('button', { class: 'chordf__exam-btn', onclick: toggleMidi }, '连接 MIDI 键盘')
  const midiStatus = el('span', { class: 'chordf__midi-status' })
  const examBar = el(
    'div',
    { class: 'chordf__exambar', hidden: true },
    examStreak,
    nextBtn,
    exitBtn,
    midiBtn,
    midiStatus,
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
      ),
    ),
    headline,
    feedback,
    examBar,
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
    if (state.mode !== 'exam' || q === null) return
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

  function syncHeld(): void {
    engine.setHeld(new Set([...virtualHeld, ...midiHeld]))
    if (state.mode === 'exam') renderExam()
    else renderBrowse()
  }

  function startExam(): void {
    state.mode = 'exam'
    streak = 0
    total = 0
    virtualHeld.clear()
    engine.releaseAll()
    examBar.hidden = false
    ask()
    renderAll()
  }

  function ask(): void {
    if (nextTimer !== undefined) {
      clearTimeout(nextTimer)
      nextTimer = undefined
    }
    question = nextExamQuestion(state.hand, state.transpose)
    virtualHeld.clear()
    engine.setQuestion(question.pitches)
    renderExam()
    renderExamBar()
  }

  function exitExam(): void {
    if (nextTimer !== undefined) {
      clearTimeout(nextTimer)
      nextTimer = undefined
    }
    state.mode = 'browse'
    question = null
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
      midiStatus.textContent = midiStatusText(ev.status, ev.detail)
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

  /** 选择根音 / 类型 / 转位都会退出考试回到浏览（考试题目独立随机生成） */
  function pickAndExitExam(apply: () => void): () => void {
    return () => {
      apply()
      if (state.mode === 'exam') exitExam()
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
          pickAndExitExam(() => (state.root = n)),
        ),
      ),
    )
    qualityRow.replaceChildren(
      ...CHORD_QUALITIES.map((q) =>
        chip(
          `${QUALITY_LABELS[q.id]}${q.symbols[0] === '' ? '' : ` ${q.symbols[0]}`}`,
          state.quality === q.id,
          pickAndExitExam(() => {
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
          pickAndExitExam(() => (state.inversion = i)),
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

    // 涉及音符半透明高亮 + 指法数字徽标；用户按下：和弦内变实、按错标红
    const lit = new Map<number, { state: ExamKeyState; alpha: number; glow: number }>()
    for (const p of pitches) lit.set(p, { state: 'held', alpha: 0.45, glow: 0 })
    for (const p of virtualHeld) {
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

  function renderExam(): void {
    if (question === null) return
    const st = engine.state
    headlineMain.textContent = `请弹奏：${chordSymbol(question.root, question.quality)}`
    headlineSub.textContent = `${INVERSION_NAMES[question.inversion]} · ${HAND_NAMES[question.hand]}${
      state.transpose !== 0 ? ` · 移调 ${state.transpose > 0 ? '+' : ''}${state.transpose}` : ''
    }`

    if (st.solved) return // onSolved 已画绿色与指法
    const lit = new Map<number, { state: ExamKeyState; alpha: number; glow: number }>()
    for (const p of st.held) lit.set(p, { state: 'held', alpha: 1, glow: 0.3 })
    for (const p of st.wrong) lit.set(p, { state: 'wrong', alpha: 1, glow: 0.6 })
    keyboard.paint(lit)
    keyboard.setBadges(new Map()) // 考试中不亮指法，避免提示答案
  }

  function renderAll(): void {
    renderRows()
    if (state.mode === 'exam') {
      renderExam()
      renderExamBar()
    } else {
      renderBrowse()
    }
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
