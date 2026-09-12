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
import { EdgeTrainer, type TrainerState } from '../../core/practice/edge-trainer'
import { EdgeStatsStore } from '../../core/practice/edge-stats'
import { midiNoteName } from '../../core/midi/note-name'
import { el } from '../../ui/dom'
import { buildChordKeyboard, type ChordKeyboard, type ExamKeyState } from './chord-keyboard'
import { buildFigure, chordByNode, toEdgeGraph } from './harmony-graph'
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
  // 魔方练习模式：null = 关闭；follow = 跟弹（目标可见）；predict = 预测（目标隐藏，
  // 路线按和声倾向贪心选择——resolution 优先、同权重回大三，可学习可预判）
  let wheelGuided = false
  let wheelPredict = false
  let continuousFlow = false // 连续流：弹对后跳过等待直接下一题
  let questionSettled = false // 本题已记录结果，忽略后续输入直到换题
  let predictMissSeen = false // 预测模式：按住的音已构成非目标和弦（全部松开后结算为失败）
  const followChip = el(
    'button',
    {
      class: 'chordf__chip',
      title: '跟弹：目标和弦节点高亮，在琴上弹对自动下一题',
      onclick: () => setWheelMode(wheelGuided && !wheelPredict ? null : 'follow'),
    },
    '跟弹',
  )
  const predictChip = el(
    'button',
    {
      class: 'chordf__chip',
      title: '预测：只显示当前和弦，按和声倾向预判下一站并弹出',
      onclick: () => setWheelMode(wheelPredict ? null : 'predict'),
    },
    '预测',
  )
  const flowChip = el(
    'button',
    {
      class: 'chordf__chip',
      title: '连续流：弹对后不加等待，直接进入下一题',
      onclick: () => {
        continuousFlow = !continuousFlow
        flowChip.classList.toggle('is-active', continuousFlow)
      },
    },
    '连流',
  )
  // 薄弱连接轻量视图：Top 5 低熟练转换（验证 Edge Mastery 是否真的工作）
  const weakPanel = el('div', { class: 'chordf__weak', hidden: true })
  const weakToggle = el(
    'button',
    {
      class: 'chordf__chip',
      title: '熟练度最低的 5 条连接（来自本地练习记录）',
      onclick: () => {
        weakPanel.hidden = !weakPanel.hidden
        weakToggle.classList.toggle('is-active', !weakPanel.hidden)
        if (!weakPanel.hidden) renderWeakPanel()
      },
    },
    '薄弱',
  )
  const wheelHeader = el(
    'div',
    { class: 'chordf__wheelhead' },
    viewSeg.el,
    followChip,
    predictChip,
    flowChip,
    weakToggle,
  )
  // 训练状态条：最近一步 / 本次计数 / 路径
  const pathBar = el('div', { class: 'chordf__path', hidden: true })
  const wheelWrap = el(
    'div',
    { class: 'chordf__wheelwrap', hidden: true },
    wheelHeader,
    pathBar,
    weakPanel,
    wheelFunctional.el,
    wheelVoiceleading.el,
  )

  const transposeLabel = el('span', { class: 'chordf__transpose-val' }, '0')
  const shiftTranspose = (d: number): void => {
    const next = state.transpose + d
    if (next < MIN_TRANSPOSE || next > MAX_TRANSPOSE) return
    state.transpose = next
    if ((isPracticing() || (state.mode === 'wheel' && wheelGuided)) && question !== null) {
      // 题目音高同步平移（指法不变）
      question = { ...question, pitches: question.pitches.map((p) => p + d) }
      engine.setQuestion(question.pitches)
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
        if (hasQuiz() && !engine.state.solved) streak = 0 // 未答完跳过：连对清零
        next()
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
    if (!hasQuiz() || q === null || questionSettled) return
    questionSettled = true
    streak += 1
    total += 1
    // 解答成立：目标键闪绿并亮出指法
    const lit = new Map<number, { state: ExamKeyState; alpha: number; glow: number }>()
    for (const p of q.pitches) lit.set(p, { state: 'solved', alpha: 1, glow: 0.5 })
    keyboard.paint(lit)
    keyboard.setBadges(new Map(q.pitches.map((p, i) => [p, q.fingers[i]])))
    // Edge 训练：成功入账（响应时间 = 目标出现 → 弹对），再沿图推进
    if (state.mode === 'wheel' && wheelGuided && trainer !== null) {
      trainer.reportResult(true, performance.now() - questionStartedAt)
      trainerState = trainer.state()
      renderWheel()
      // solved 态 renderWheel 会提前返回，路径条在这里直接刷新（✓ 立即可见）
      pathBar.hidden = false
      pathBar.textContent = trainerStepText(trainerState)
    }
    renderExamBar()
    nextTimer = window.setTimeout(() => next(), autoNextDelay())
  })

  /** 是否处于键盘出题练习（跟弹 / 考试） */
  function isPracticing(): boolean {
    return state.mode === 'guided' || state.mode === 'exam'
  }

  /** 是否处于出题判定（跟弹 / 考试 / 魔方跟弹） */
  function hasQuiz(): boolean {
    return isPracticing() || (state.mode === 'wheel' && wheelGuided)
  }

  /** 下一题：键盘模式直接换题；魔方模式先沿图推进（跳过不记结果）再出题 */
  function next(): void {
    if (state.mode === 'wheel') {
      if (wheelGuided && trainer !== null) {
        trainer.advance()
        trainerState = trainer.state()
      }
      askWheel()
    } else ask()
  }

  function syncHeld(): void {
    engine.setHeld(new Set([...virtualHeld, ...midiHeld]))
    const heldAll = [...virtualHeld, ...midiHeld]
    // —— 预测模式：按音级内容判定（任意排列都算），不要求与题目同八度 ——
    if (state.mode === 'wheel' && wheelPredict && question !== null && !questionSettled) {
      const targetNode = trainerState?.targetNodeId ?? null
      const detected = heldAll.length >= 3 ? detectChord(heldAll) : null
      if (detected !== null && targetNode !== null) {
        const detectedNode = `${wheelRootName(detected.root)}/${detected.quality}`
        if (detectedNode === targetNode) {
          // 预判正确：按住的键闪绿，成功入账并推进
          questionSettled = true
          streak += 1
          total += 1
          const lit = new Map<number, { state: ExamKeyState; alpha: number; glow: number }>()
          for (const p of heldAll) lit.set(p, { state: 'solved', alpha: 1, glow: 0.5 })
          keyboard.paint(lit)
          if (trainer !== null) {
            trainer.reportResult(true, performance.now() - questionStartedAt)
            trainerState = trainer.state()
            pathBar.hidden = false
            pathBar.textContent = trainerStepText(trainerState)
          }
          renderExamBar()
          nextTimer = window.setTimeout(() => next(), autoNextDelay())
        } else {
          predictMissSeen = true // 非目标和弦：弹奏途中不判错，等全部松开再结算
        }
      }
      if (predictMissSeen && heldAll.length === 0) {
        // 预判错误结算：记一次失败，短暂揭示路线后推进
        questionSettled = true
        streak = 0
        if (trainer !== null) {
          trainer.reportResult(false)
          trainerState = trainer.state()
          pathBar.hidden = false
          pathBar.textContent = trainerStepText(trainerState)
        }
        const q = question
        const reveal = new Map<number, { state: ExamKeyState; alpha: number; glow: number }>()
        for (const p of q.pitches) reveal.set(p, { state: 'held', alpha: 0.9, glow: 0.4 })
        keyboard.paint(reveal)
        renderExamBar()
        nextTimer = window.setTimeout(() => next(), continuousFlow ? 800 : 1500)
        return
      }
    }
    if (questionSettled && state.mode === 'wheel') return // 已结算：保留揭示画面
    // Edge 训练失败检测：本题按错过、且现在全部松开仍未成立 → 记一次失败
    // （不打断训练：不结束计时，弹对后仍记成功；同一题失败只记一次）
    if (state.mode === 'wheel' && wheelGuided && trainer !== null && question !== null) {
      const st = engine.state
      if (st.wrong.size > 0) questionHadWrong = true
      if (questionHadWrong && !questionFailReported && !st.solved && st.held.size === 0) {
        questionFailReported = true
        streak = 0
        trainer.reportResult(false)
        trainerState = trainer.state()
      }
    }
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

  /** 进入魔方模式：跟弹开着就接着出题（trainer 保留进度），否则纯浏览 */
  function enterWheel(): void {
    if (nextTimer !== undefined) {
      clearTimeout(nextTimer)
      nextTimer = undefined
    }
    state.mode = 'wheel'
    question = null
    hintOn = false
    engine.reset()
    if (wheelGuided) {
      trainerState = null
      next()
    }
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

  // —— Edge Trainer（Graph-Driven）：边 = 训练对象，边级 mastery 影响出题概率 ——
  // 职责分离：ChordPracticeEngine 判「弹对没有」，EdgeTrainer 定「下一步去哪」，
  // EdgeStatsStore 记「哪条连接该多练」。stats 持久化 localStorage（版本化 key）。
  let edgeStats: EdgeStatsStore | null = null
  let trainer: EdgeTrainer | null = null
  let trainerView: WheelView | null = null
  let questionStartedAt = 0
  let questionHadWrong = false
  let questionFailReported = false
  let trainerState: TrainerState | null = null

  function getEdgeStats(): EdgeStatsStore {
    if (edgeStats === null) {
      let storage: Storage | null
      try {
        storage = window.localStorage
      } catch {
        storage = null // 隐私模式等：内存态运行
      }
      edgeStats = new EdgeStatsStore(storage)
    }
    return edgeStats
  }

  /** 当前子视图的 trainer（切图保留进度：目标节点若在新图中存在则延续） */
  function getTrainer(): EdgeTrainer {
    if (trainer === null || trainerView !== state.wheelView) {
      const figure = buildFigure(state.wheelView)
      const carryTarget =
        trainer !== null && trainer.targetNodeId !== null ? trainer.targetNodeId : null
      trainer = new EdgeTrainer(toEdgeGraph(figure), {
        stats: getEdgeStats(),
        strategy: wheelPredict ? 'greedy' : 'random',
      })
      trainerView = state.wheelView
      trainerState = null
      trainer.start(carryTarget ?? undefined)
    }
    return trainer
  }

  const NODE_SUFFIX: Readonly<Record<string, string>> = {
    major: '',
    minor: 'm',
    dominant7: '7',
    diminished7: '°',
  }

  /** 节点 id（`root/quality`）→ 显示符号（C / G7 / Am / B°） */
  function nodeSymbol(nodeId: string | null): string {
    if (nodeId === null || nodeId === '') return '?'
    const slash = nodeId.indexOf('/')
    const root = nodeId.slice(0, slash)
    const quality = nodeId.slice(slash + 1)
    return `${root}${NODE_SUFFIX[quality] ?? ''}`
  }

  /** 边 id（`A->B:type`）→ 端点节点对 */
  function pairOfEdgeId(edgeIdStr: string): { from: string; to: string } {
    const arrow = edgeIdStr.indexOf('->')
    const colon = edgeIdStr.lastIndexOf(':')
    return { from: edgeIdStr.slice(0, arrow), to: edgeIdStr.slice(arrow + 2, colon) }
  }

  /** 图节点 id（`root/quality`）→ WheelChord（id 即图拼写，无需折算） */
  function wheelNodeFromId(nodeId: string): WheelChord | null {
    const slash = nodeId.indexOf('/')
    const root = nodeId.slice(0, slash)
    const quality = nodeId.slice(slash + 1)
    if (root === '' || quality === '') return null
    return { root, quality } as WheelChord
  }

  function trainerStepText(tr: TrainerState): string {
    const path = tr.recentPath
    const last = path[path.length - 1]
    const lastText =
      last === undefined
        ? '刚起步'
        : `${nodeSymbol(last.from)} → ${nodeSymbol(last.to)} ${last.result === 'success' ? '✓' : '✗'}${
            last.responseTimeMs !== undefined ? ` ${(last.responseTimeMs / 1000).toFixed(1)}s` : ''
          }`
    // 路径只显示最近 8 个节点，更长时前缀省略号
    const nodes = [path.length > 0 ? path[0].from : tr.currentNodeId, ...path.map((p) => p.to)]
    const shown = nodes.slice(-8)
    return `最近一步：${lastText} · 本次 ${tr.session.steps} 步 ${tr.session.successes} 对 ${tr.session.failures} 错 · 路径${
      nodes.length > shown.length ? '…' : ''
    }：${shown.map((n) => nodeSymbol(n)).join(' → ')}`
  }

  /** 从 trainer 的目标节点出题（计时起点 = 目标出现） */
  function askWheel(): void {
    if (nextTimer !== undefined) {
      clearTimeout(nextTimer)
      nextTimer = undefined
    }
    const tr = getTrainer()
    trainerState = tr.state()
    const targetId = trainerState.targetNodeId
    const chords = chordByNode(buildFigure(state.wheelView))
    const chord = targetId !== null ? chords.get(targetId) : undefined
    if (chord === undefined) return // 图无目标（不应发生）
    const notes = getChordNotes(chord.root, chord.quality, 0)
    question = {
      root: chord.root,
      quality: chord.quality,
      inversion: 0,
      hand: state.hand,
      pitches: notes.pitches.map((p) => p + state.transpose),
      fingers: getChordFingering({
        root: chord.root,
        quality: chord.quality,
        inversion: 0,
        hand: state.hand,
      }).fingers,
    }
    hintOn = false
    virtualHeld.clear()
    questionStartedAt = performance.now()
    questionHadWrong = false
    questionFailReported = false
    questionSettled = false
    predictMissSeen = false
    engine.setQuestion(question.pitches)
    renderWheel()
    renderExamBar()
  }

  /** 自动进入下一题的等待（连续流开启时几乎无等待） */
  function autoNextDelay(): number {
    return state.mode === 'wheel' && continuousFlow ? 120 : 900
  }

  /** 薄弱连接定向练习：从该边的起点直接开始训练这条连接 */
  function focusWeakEdge(edgeId: string): void {
    if (state.mode !== 'wheel') return
    if (!wheelGuided) setWheelMode('follow')
    const tr = getTrainer()
    if (!tr.focusEdge(edgeId)) return
    weakPanel.hidden = true
    weakToggle.classList.remove('is-active')
    if (nextTimer !== undefined) {
      clearTimeout(nextTimer)
      nextTimer = undefined
    }
    askWheel()
  }

  /** 魔方练习模式开关：开启即出题，关闭复位判定与计数（trainer 保留以便续练） */
  function setWheelMode(mode: 'follow' | 'predict' | null): void {
    wheelGuided = mode !== null
    wheelPredict = mode === 'predict'
    streak = 0
    total = 0
    if (wheelGuided) {
      getTrainer().setStrategy(wheelPredict ? 'greedy' : 'random')
      questionSettled = false
      askWheel()
    } else {
      if (nextTimer !== undefined) {
        clearTimeout(nextTimer)
        nextTimer = undefined
      }
      question = null
      engine.reset()
      virtualHeld.clear()
      trainerState = null
      questionSettled = false
    }
    renderAll()
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

  /** 薄弱连接面板：当前图上熟练度最低的 5 条已练转换（本地记录，刷新保留） */
  function renderWeakPanel(): void {
    const store = getEdgeStats()
    const graphEdges = new Set(toEdgeGraph(buildFigure(state.wheelView)).edges.map((e) => e.id))
    const rows = store
      .weakest(20)
      .filter((w) => graphEdges.has(w.edgeId))
      .slice(0, 5)
    weakPanel.replaceChildren()
    if (rows.length === 0) {
      weakPanel.append(
        el(
          'div',
          { class: 'chordf__weak-empty' },
          '暂无数据：开跟弹练几步，这里会列出最该补的连接',
        ),
      )
      return
    }
    for (const row of rows) {
      const { from, to } = pairOfEdgeId(row.edgeId)
      weakPanel.append(
        el(
          'button',
          {
            class: 'chordf__weak-row',
            title: '定向练习：直接从这条连接开始',
            onclick: () => focusWeakEdge(row.edgeId),
          },
          el('span', { class: 'chordf__weak-pair' }, `${nodeSymbol(from)} → ${nodeSymbol(to)}`),
          el(
            'span',
            { class: 'chordf__weak-bar' },
            el('span', {
              class: 'chordf__weak-fill',
              style: { width: `${Math.round(row.mastery * 100)}%` },
            }),
          ),
          el('span', { class: 'chordf__weak-pct' }, `${Math.round(row.mastery * 100)}%`),
        ),
      )
    }
  }

  /** 魔方模式：键盘照常显示选中和弦与弹奏回显；图上高亮选中和弹奏识别的节点；
   *  跟弹开启时改为目标驱动——目标节点脉冲 + 键盘目标键位/指法，弹对自动下一题 */
  function renderWheel(): void {
    const held = new Set([...virtualHeld, ...midiHeld])
    const detected = detectChord(held)
    // 减七等音多解：一个减七音集点亮全部 4 个 ° 节点（转调枢纽的教学点）
    const played: WheelChord[] =
      detected === null
        ? []
        : detected.quality === 'diminished7'
          ? detectDim7Roots(held).map((r) => ({ root: r, quality: 'diminished7' as const }))
          : [{ root: detected.root, quality: detected.quality }]
    const playedList = played.map((c) => ({ ...c, root: wheelRootName(c.root) }))
    const wheelViewName = state.wheelView === 'functional' ? '转调图' : '走线图'
    const st = engine.state

    if (wheelGuided && question !== null && state.mode === 'wheel') {
      // —— 跟弹：目标节点脉冲 + 键盘目标键位/指法 ——
      const q = question
      if (st.solved || questionSettled) return // 已结算：保留成功/揭示画面，等待自动下一题
      const qFingering = getChordFingering({
        root: q.root,
        quality: q.quality,
        inversion: q.inversion,
        hand: state.hand,
        profile: state.profileId,
      })
      if (wheelPredict) {
        // —— 预测：只亮当前位置；目标完全隐藏，凭和声倾向预判下一站 ——
        headlineMain.textContent = `预判：${nodeSymbol(trainerState?.currentNodeId ?? '')} → ?`
        headlineSub.textContent = [
          wheelViewName,
          '弹这条走线的下一站（任意转位/排列，按音判定）',
          '倾向提示：解决线最优先，同权重回大三',
        ]
          .filter(Boolean)
          .join(' · ')
        const lit = new Map<number, { state: ExamKeyState; alpha: number; glow: number }>()
        for (const p of st.held) lit.set(p, { state: 'held', alpha: 1, glow: 0.3 })
        for (const p of st.wrong) lit.set(p, { state: 'wrong', alpha: 1, glow: 0.6 })
        keyboard.paint(lit)
        const currentNode =
          trainerState !== null && trainerState.currentNodeId !== ''
            ? wheelNodeFromId(trainerState.currentNodeId)
            : null
        wheelFunctional.setSelected(currentNode)
        wheelVoiceleading.setSelected(currentNode)
        wheelFunctional.setTarget(null)
        wheelVoiceleading.setTarget(null)
        wheelFunctional.setActiveEdge(null)
        wheelVoiceleading.setActiveEdge(null)
        const visitedPairs = (trainerState?.recentPath ?? []).map((p) => pairOfEdgeId(p.edgeId))
        wheelFunctional.setVisitedEdges(visitedPairs)
        wheelVoiceleading.setVisitedEdges(visitedPairs)
        wheelFunctional.setPlayed([])
        wheelVoiceleading.setPlayed([])
        pathBar.hidden = trainerState === null
        if (trainerState !== null) pathBar.textContent = trainerStepText(trainerState)
        return
      }
      headlineMain.textContent = `请弹奏：${chordSymbol(q.root, q.quality)}`
      headlineSub.textContent = [
        wheelViewName,
        INVERSION_NAMES[q.inversion],
        HAND_NAMES[q.hand],
        `指法 ${qFingering.fingers.join('-')}`,
        trainerState !== null && trainerState.activeEdgeId !== null
          ? `沿走线 ${nodeSymbol(trainerState.currentNodeId)} → ${nodeSymbol(trainerState.targetNodeId)} 行进`
          : '从当前位置沿走线继续',
      ]
        .filter(Boolean)
        .join(' · ')
      const lit = new Map<number, { state: ExamKeyState; alpha: number; glow: number }>()
      for (const p of q.pitches) {
        if (!st.held.has(p)) lit.set(p, { state: 'held', alpha: 0.35, glow: 0 })
      }
      for (const p of st.held) lit.set(p, { state: 'held', alpha: 1, glow: 0.3 })
      for (const p of st.wrong) lit.set(p, { state: 'wrong', alpha: 1, glow: 0.6 })
      keyboard.paint(lit)
      keyboard.setBadges(new Map(q.pitches.map((p, i) => [p, qFingering.fingers[i]])))
      const target = { root: wheelRootName(q.root), quality: q.quality as WheelChord['quality'] }
      // 视觉层级：普通边 → 走过（visited）→ 活跃边（active）→ 目标节点脉冲；
      // 当前节点 = 琥珀实选。路径与活跃边来自 trainer（边的两端即节点 id）
      const tr = trainerState
      const currentNode =
        tr !== null && tr.currentNodeId !== '' ? wheelNodeFromId(tr.currentNodeId) : null
      wheelFunctional.setSelected(currentNode)
      wheelVoiceleading.setSelected(currentNode)
      wheelFunctional.setTarget(target)
      wheelVoiceleading.setTarget(target)
      const activePair =
        tr !== null && tr.activeEdgeId !== null ? pairOfEdgeId(tr.activeEdgeId) : null
      wheelFunctional.setActiveEdge(activePair)
      wheelVoiceleading.setActiveEdge(activePair)
      const visitedPairs = (tr?.recentPath ?? []).map((p) => pairOfEdgeId(p.edgeId))
      wheelFunctional.setVisitedEdges(visitedPairs)
      wheelVoiceleading.setVisitedEdges(visitedPairs)
      wheelFunctional.setPlayed(playedList)
      wheelVoiceleading.setPlayed(playedList)
      // 训练状态条：最近一步 / 本次计数 / 路径
      pathBar.hidden = trainerState === null
      if (trainerState !== null) pathBar.textContent = trainerStepText(trainerState)
      return
    }

    // —— 浏览式魔方：选中和弦 + 弹奏实时定位 ——
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
      wheelViewName,
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
    wheelFunctional.setSelected(wheelSel)
    wheelFunctional.setPlayed(playedList)
    wheelVoiceleading.setSelected(wheelSel)
    wheelVoiceleading.setPlayed(playedList)
    wheelFunctional.setTarget(null)
    wheelVoiceleading.setTarget(null)
    wheelFunctional.setActiveEdge(null)
    wheelVoiceleading.setActiveEdge(null)
    wheelFunctional.setVisitedEdges([])
    wheelVoiceleading.setVisitedEdges([])
    pathBar.hidden = true
  }

  function renderAll(): void {
    renderRows()
    wheelWrap.hidden = state.mode !== 'wheel'
    wheelFunctional.el.hidden = state.wheelView !== 'functional'
    wheelVoiceleading.el.hidden = state.wheelView !== 'voiceleading'
    viewSeg.set(state.wheelView)
    followChip.classList.toggle('is-active', wheelGuided && !wheelPredict)
    predictChip.classList.toggle('is-active', wheelPredict)
    examBar.hidden = state.mode === 'browse' || (state.mode === 'wheel' && !wheelGuided)
    exitBtn.hidden = state.mode === 'wheel'
    hintBtn.hidden = state.mode !== 'exam'
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
