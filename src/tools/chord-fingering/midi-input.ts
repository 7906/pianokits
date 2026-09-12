import { parseMidiMessage } from '../../core/midi/input'
import { CONNECT_TIMEOUT_MS } from '../../core/midi/connection'

/**
 * MIDI 输入适配器（规格 §11）：把 Web MIDI 的 noteOn/noteOff 流变成
 * 「当前按下的音高集合」推送练习引擎——chord-fingering UI 不直接读取
 * Web MIDI，考试判定逻辑与虚拟键盘共用（规格 §8 的 MidiInput 形态）。
 *
 * 连接超时采用与调试工具一致的软超时：CONNECT_TIMEOUT_MS 未返回时先提示
 * “连接超时”，但不放弃在途请求（晚到的成功结果仍照常接管）。
 * 事件携带已连接输入设备名列表——设备插入/拔出（statechange）后刷新，
 * UI 据此显示「连的到底是什么」，方便排查 FP-30X 未被识别类问题。
 */

export type MidiAdapterStatus =
  'idle' | 'connecting' | 'connected' | 'timeout' | 'denied' | 'unsupported' | 'error'

export interface MidiAdapterEvent {
  status: MidiAdapterStatus
  /** 当前按下的音高（每次按键事件后全量推送） */
  held: readonly number[]
  /** 已授权访问的 MIDI 输入设备名列表（连接成功后返回；空 = 未检测到设备） */
  inputs: readonly string[]
  /** error / timeout 时的补充说明 */
  detail?: string
}

/**
 * 面向用户的状态文案：不裸抛术语，把「下一步该做什么」写进提示
 * （unsupported 直接给 iPad/桌面双路径指引）。
 */
export function midiStatusText(
  status: MidiAdapterStatus,
  detail?: string,
  inputs?: readonly string[],
): string {
  switch (status) {
    case 'connecting':
      return '连接中…'
    case 'connected':
      return inputs && inputs.length > 0
        ? `已连接 · ${inputs.join('、')}`
        : '已授权，未检测到输入设备（确认琴已开机并连接后自动识别）'
    case 'timeout':
      return '连接超时（仍在等待授权返回，可稍候或在浏览器弹窗里允许）'
    case 'denied':
      return 'MIDI 授权被拒绝：在浏览器站点设置里允许 MIDI 后重试'
    case 'unsupported':
      return '此浏览器不支持 Web MIDI（iPad 的 Safari/Chrome 均不支持）· iPad 请用 Web MIDI Browser App，电脑请用 Chrome/Edge'
    case 'error':
      return `连接失败${detail ? `：${detail}` : ''}`
    default:
      return '未连接'
  }
}

/**
 * 启动 MIDI 输入并持续把按住音高集合推给 onEvent；返回停止函数（移除监听、
 * 关闭状态订阅）。
 */
export function startMidiInput(onEvent: (ev: MidiAdapterEvent) => void): () => void {
  if (typeof navigator.requestMIDIAccess !== 'function') {
    onEvent({ status: 'unsupported', held: [], inputs: [] })
    return () => {}
  }

  let stopped = false
  let access: MIDIAccess | null = null
  const attached: MIDIInput[] = []
  const held = new Set<number>()

  const inputNames = (): string[] => {
    const names: string[] = []
    // shim 的端口表不可迭代，用 forEach 收集（与调试工具一致）
    access?.inputs.forEach((input) => names.push(input.name?.trim() || '未命名设备'))
    return names
  }

  const emit = (status: MidiAdapterStatus, detail?: string): void => {
    if (stopped) return
    onEvent({ status, held: [...held].sort((a, b) => a - b), inputs: inputNames(), detail })
  }

  const onMessage = (e: MIDIMessageEvent): void => {
    const data = e.data
    if (data === null || stopped) return
    const ev = parseMidiMessage(data)
    if (ev === null) return
    // velocity 0 的 noteOn 视为抬起（部分键盘以此表达 noteOff）
    if (ev.type === 'noteOn' && ev.velocity > 0) held.add(ev.pitch)
    else held.delete(ev.pitch)
    emit('connected')
  }

  const attach = (): void => {
    for (const input of attached) input.removeEventListener('midimessage', onMessage)
    attached.length = 0
    if (access === null) return
    access.inputs.forEach((input) => {
      input.addEventListener('midimessage', onMessage)
      attached.push(input)
    })
  }

  emit('connecting')
  const timeoutTimer = window.setTimeout(() => emit('timeout'), CONNECT_TIMEOUT_MS)

  navigator.requestMIDIAccess({ sysex: false }).then(
    (a) => {
      if (stopped) return
      clearTimeout(timeoutTimer)
      access = a
      attach()
      // 设备插入/拔出：重挂监听并刷新设备列表展示
      a.addEventListener('statechange', () => {
        if (stopped) return
        attach()
        emit('connected')
      })
      emit('connected')
    },
    (err: unknown) => {
      if (stopped) return
      clearTimeout(timeoutTimer)
      if (err instanceof DOMException && err.name === 'NotAllowedError') emit('denied')
      else emit('error', err instanceof Error ? err.message : String(err))
    },
  )

  return () => {
    stopped = true
    clearTimeout(timeoutTimer)
    for (const input of attached) input.removeEventListener('midimessage', onMessage)
    attached.length = 0
    access = null
  }
}
