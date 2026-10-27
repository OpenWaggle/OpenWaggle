import type { TerminalAttachResult } from '@shared/types/terminal'
import { Terminal } from '@xterm/xterm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTerminalOutputDelivery } from '../terminal-output-delivery'
import { connectTerminalInput } from '../terminal-replay-input-guard'

const ESC = '\x1b'
const BEL = '\x07'
const ST = `${ESC}\\`
const PALETTE_SIZE = 16
const OUTPUT_GENERATION = 1
const LARGE_REPLAY_LINES = 20_000

/** Pi's TUI palette probe plus the other queries programs send to a live terminal. */
const PALETTE_QUERIES = Array.from(
  { length: PALETTE_SIZE },
  (_, index) => `${ESC}]4;${index};?${ST}`,
).join('')
const OTHER_QUERIES = [
  `${ESC}]10;?${BEL}`,
  `${ESC}]11;?${ST}`,
  `${ESC}]12;?${BEL}`,
  `${ESC}[c`,
  `${ESC}[>c`,
  `${ESC}[5n`,
  `${ESC}[6n`,
  `${ESC}[?6n`,
  `${ESC}[?2004$p`,
  `${ESC}[4$p`,
  `${ESC}[>q`,
  `${ESC}P$qm${ST}`,
  `${ESC}[?u`,
  `${ESC}[?996n`,
].join('')

const originalMatchMedia = Object.getOwnPropertyDescriptor(window, 'matchMedia')
const originalGetContext = Object.getOwnPropertyDescriptor(
  HTMLCanvasElement.prototype,
  'getContext',
)

function restoreProperty(target: object, key: PropertyKey, descriptor?: PropertyDescriptor) {
  if (descriptor === undefined) Reflect.deleteProperty(target, key)
  else Object.defineProperty(target, key, descriptor)
}

function stubBrowserMeasurement() {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
    }),
  })
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: () => ({ measureText: () => ({ width: 9 }) }),
  })
}

const disposers: (() => void)[] = []

afterEach(() => {
  for (const dispose of disposers.splice(0).reverse()) dispose()
  restoreProperty(window, 'matchMedia', originalMatchMedia)
  restoreProperty(HTMLCanvasElement.prototype, 'getContext', originalGetContext)
})

/** A real, opened xterm wired to the PTY the way a Session terminal pane wires it. */
function openReplayTerminal() {
  stubBrowserMeasurement()
  const mount = document.createElement('div')
  Object.defineProperties(mount, {
    clientHeight: { configurable: true, value: 480 },
    clientWidth: { configurable: true, value: 800 },
  })
  document.body.append(mount)
  const term = new Terminal({ cols: 80, rows: 24, scrollback: 1_000 })
  term.open(mount)
  const textarea = mount.querySelector<HTMLTextAreaElement>('textarea.xterm-helper-textarea')
  if (textarea === null) throw new Error('xterm helper textarea was not mounted')
  const acknowledge = vi.fn()
  const delivery = createTerminalOutputDelivery({
    ownerKey: 'owner',
    terminalId: 'terminal',
    terminal: term,
    acknowledge,
  })
  const sentToPty: string[] = []
  const disconnect = connectTerminalInput(term, delivery.isReplaying, (data) => {
    sentToPty.push(data)
  })
  disposers.push(() => {
    disconnect()
    term.dispose()
    mount.remove()
  })

  let liveBytes = 0
  const replay = (history: string) => {
    const outputBytes = new TextEncoder().encode(history).byteLength
    liveBytes = outputBytes
    delivery.applySnapshot({
      history,
      outputBytes,
      outputGeneration: OUTPUT_GENERATION,
      readiness: { phase: 'ready', generation: 1 },
      running: true,
      processName: null,
      ports: [],
      projectActionPending: false,
    } satisfies TerminalAttachResult)
  }
  const live = (data: string) => {
    const startOffset = liveBytes
    liveBytes += new TextEncoder().encode(data).byteLength
    delivery.write({
      type: 'output',
      data,
      outputGeneration: OUTPUT_GENERATION,
      startOffset,
      endOffset: liveBytes,
    })
  }
  /** Resolves once xterm has parsed everything queued so far. */
  const parsed = () => new Promise<void>((resolve) => term.write('', resolve))
  const screenText = () => {
    const lines: string[] = []
    const buffer = term.buffer.active
    for (let row = 0; row < buffer.length; row += 1) {
      lines.push(buffer.getLine(row)?.translateToString(true) ?? '')
    }
    return lines.join('\n')
  }
  const type = (key: string, code: string, keyCode: number) => {
    const event = new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true })
    Object.defineProperties(event, {
      keyCode: { configurable: true, value: keyCode },
      which: { configurable: true, value: keyCode },
    })
    textarea.dispatchEvent(event)
  }
  return { delivery, live, parsed, replay, screenText, sentToPty, term, type }
}

describe('replaying terminal history that contains terminal queries', () => {
  it('types nothing into the shell when the history holds palette, colour, DA and DSR queries', async () => {
    const terminal = openReplayTerminal()

    terminal.replay(`pi starting${PALETTE_QUERIES}${OTHER_QUERIES}\r\npi exited\r\n$ `)
    await terminal.parsed()

    expect(terminal.sentToPty).toEqual([])
    expect(terminal.screenText()).toContain('pi starting')
    expect(terminal.screenText()).toContain('pi exited')
  })

  it('drops reports xterm generates for replayed mode changes that are not stripped', async () => {
    const terminal = openReplayTerminal()

    // Focus reporting is a mode, not a query, so it survives stripping; enabling it makes
    // xterm report the current focus state at once.
    terminal.replay(`${ESC}[?1004hfocus-aware program\r\n`)
    await terminal.parsed()

    expect(terminal.sentToPty).toEqual([])
  })

  it('stays clean across repeated reattaches', async () => {
    for (let attach = 0; attach < 3; attach += 1) {
      const terminal = openReplayTerminal()
      terminal.replay(`${PALETTE_QUERIES}$ `)
      await terminal.parsed()
      expect(terminal.sentToPty).toEqual([])
    }
  })

  it('still answers a live query that arrives after the replay', async () => {
    const terminal = openReplayTerminal()
    terminal.replay(`${PALETTE_QUERIES}$ `)
    await terminal.parsed()

    terminal.live(`${ESC}[5n`)
    await terminal.parsed()

    expect(terminal.sentToPty).toEqual([`${ESC}[0n`])
  })

  it('answers live queries that arrive while the replay is still parsing, in order', async () => {
    const terminal = openReplayTerminal()
    terminal.replay(
      `${'old line\r\n'.repeat(LARGE_REPLAY_LINES)}${PALETTE_QUERIES}${OTHER_QUERIES}`,
    )
    terminal.live(`${ESC}[5n`)
    terminal.live(`${ESC}]4;1;?${ST}`)
    terminal.live(`${ESC}[c`)
    await terminal.parsed()

    expect(terminal.sentToPty).toHaveLength(3)
    expect(terminal.sentToPty[0]).toBe(`${ESC}[0n`)
    const paletteAnswer = terminal.sentToPty[1] ?? ''
    expect(paletteAnswer.startsWith(`${ESC}]4;1;rgb:`)).toBe(true)
    expect(paletteAnswer.endsWith(ST)).toBe(true)
    expect(terminal.sentToPty[2]).toBe(`${ESC}[?1;2c`)
  })

  it('delivers what the user types while the replay is still parsing', async () => {
    const terminal = openReplayTerminal()
    terminal.replay(
      `${'old line\r\n'.repeat(LARGE_REPLAY_LINES)}${PALETTE_QUERIES}${OTHER_QUERIES}`,
    )

    expect(terminal.delivery.isReplaying()).toBe(true)
    terminal.type('a', 'KeyA', 65)
    terminal.type('ArrowUp', 'ArrowUp', 38)
    // Text input that xterm emits outside a DOM event (IME composition) is still typing.
    terminal.term.input('é', true)
    await terminal.parsed()

    expect(terminal.delivery.isReplaying()).toBe(false)
    expect(terminal.sentToPty).toEqual(['a', `${ESC}[A`, 'é'])
  })
})
