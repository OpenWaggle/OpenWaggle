import { Terminal } from '@xterm/xterm'
import { afterEach, describe, expect, it } from 'vitest'

const CSI = '\u001b['
const originalMatchMedia = Object.getOwnPropertyDescriptor(window, 'matchMedia')
const originalGetContext = Object.getOwnPropertyDescriptor(
  HTMLCanvasElement.prototype,
  'getContext',
)

function restoreProperty(target: object, key: PropertyKey, descriptor?: PropertyDescriptor) {
  if (descriptor === undefined) Reflect.deleteProperty(target, key)
  else Object.defineProperty(target, key, descriptor)
}

function write(term: Terminal, data: string) {
  return new Promise<void>((resolve) => term.write(data, resolve))
}

function openTerminal() {
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
  const mount = document.createElement('div')
  Object.defineProperties(mount, {
    clientHeight: { configurable: true, value: 480 },
    clientWidth: { configurable: true, value: 800 },
  })
  document.body.append(mount)
  const term = new Terminal({
    cols: 80,
    rows: 24,
    vtExtensions: { kittyKeyboard: true },
  })
  const data: string[] = []
  term.onData((chunk) => data.push(chunk))
  term.open(mount)
  const input = mount.querySelector<HTMLTextAreaElement>('textarea.xterm-helper-textarea')
  if (input === null) throw new Error('xterm helper textarea was not mounted')
  return { data, input, mount, term }
}

function keyboardEvent(type: 'keydown' | 'keyup') {
  const event = new KeyboardEvent(type, {
    key: 'j',
    code: 'KeyJ',
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  })
  Object.defineProperties(event, {
    keyCode: { configurable: true, value: 74 },
    which: { configurable: true, value: 74 },
  })
  return event
}

describe('xterm Kitty keyboard integration', () => {
  const terminals: Terminal[] = []
  const mounts: HTMLElement[] = []

  afterEach(() => {
    for (const terminal of terminals.splice(0)) terminal.dispose()
    for (const mount of mounts.splice(0)) mount.remove()
    restoreProperty(window, 'matchMedia', originalMatchMedia)
    restoreProperty(HTMLCanvasElement.prototype, 'getContext', originalGetContext)
  })

  it('keeps legacy encoding until negotiated, then reports press and release events', async () => {
    const opened = openTerminal()
    terminals.push(opened.term)
    mounts.push(opened.mount)

    opened.input.dispatchEvent(keyboardEvent('keydown'))
    opened.input.dispatchEvent(keyboardEvent('keyup'))
    expect(opened.data).toEqual(['\n'])

    opened.data.length = 0
    await write(opened.term, `${CSI}>3u`)
    opened.input.dispatchEvent(keyboardEvent('keydown'))
    opened.input.dispatchEvent(keyboardEvent('keyup'))

    expect(opened.data).toEqual([`${CSI}106;5u`, `${CSI}106;5:3u`])
  })
})
