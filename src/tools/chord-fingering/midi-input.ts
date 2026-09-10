import { parseMidiMessage } from '../../core/midi/input'
import { CONNECT_TIMEOUT_MS } from '../../core/midi/connection'

/**
 * MIDI 输入适配器（规格 §11）：把 Web MIDI 的 noteOn/noteOff 流变成
 * 「当前按下的音高集合」推送练习引擎——chord-fingering UI 不直接读取
 * Web MIDI，考试判定逻辑与虚拟键盘共用（规格 §8 的 MidiInput 形态）。
 *
 * 连接超时采用与调试工具一致的软超时：CONNECT_TIMEOUT_MS 未返回时先提示
 * “连接超时”，但不放弃在途请求（晚到的成功结果仍照常接管）。
 */

export type MidiAdapterStatus =
  'idle' | 'connecting' | 'connected' | 'timeout' | 'denied' | 'unsupported' | 'error'

export interface MidiAdapterEvent {
  status: MidiAdapterStatus
  /** 当前按下的音高（每次按键事件后全量推送） */
  held: readonly number[]
  /** error / timeout 时的补充说明 */
  detail?: string
}

const STATUS_LABEL: Readonly<Record<MidiAdapterStatus, string>> = {
  idle: '未连接',
  connecting: '连接中…',
  connected: '已连接',
  timeout: '连接超时（仍在等待授权返回）',
  denied: '授权被拒绝',
  unsupported: '当前浏览器不支持 Web MIDI',
  error: '连接失败',
}

export function midiStatusText(status: MidiAdapterStatus, detail?: string): string {
  return detail ? `${STATUS_LABEL[status]}：${detail}` : STATUS_LABEL[status]
}

/**
 * 启动 MIDI 输入并持续把按住音高集合推给 onHeld；返回停止函数（移除监听、
 * 关闭状态订阅）。重复调用 start 时先停止上一次连接。
 */
export function startMidiInput(onEvent: (ev: MidiAdapterEvent) => void): () => void {
  if (typeof navigator.requestMIDIAccess !== 'function') {
    onEvent({ status: 'unsupported', held: [] })
    return () => {}
  }

  let stopped = false
  let access: MIDIAccess | null = null
  const attached: MIDIInput[] = []
  const held = new Set<number>()

  const emit = (status: MidiAdapterStatus, detail?: string): void => {
    if (stopped) return
    onEvent({ status, held: [...held].sort((a, b) => a - b), detail })
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
    // shim 的端口表不可迭代，用 forEach 收集（与调试工具一致）
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
      a.addEventListener('statechange', attach)
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
