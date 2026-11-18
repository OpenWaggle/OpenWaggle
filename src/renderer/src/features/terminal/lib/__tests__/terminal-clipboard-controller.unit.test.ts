import { fromPartial } from '@total-typescript/shoehorn'
import type { Terminal } from '@xterm/xterm'
import { describe, expect, it, vi } from 'vitest'
import {
  createTerminalClipboardController,
  prepareTerminalPasteData,
} from '../terminal-clipboard-controller'

function keyEvent(overrides: Partial<KeyboardEvent>) {
  return fromPartial<KeyboardEvent>({
    type: 'keydown',
    key: '',
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    preventDefault: vi.fn(),
    ...overrides,
  })
}

function terminalMock(bracketedPasteMode = false) {
  return fromPartial<Terminal>({
    modes: { bracketedPasteMode },
    getSelection: vi.fn(() => 'selected output'),
    clearSelection: vi.fn(),
    focus: vi.fn(),
  })
}

describe('terminal clipboard controller', () => {
  it('normalizes pasted newlines and preserves xterm bracketed-paste semantics', () => {
    expect(prepareTerminalPasteData('one\ntwo\r\nthree\rfour', false)).toBe('one\rtwo\rthree\rfour')
    expect(prepareTerminalPasteData('one\ntwo', true)).toBe('\u001b[200~one\rtwo\u001b[201~')
  })

  it('clears selection only after a successful plain non-Mac Ctrl+C copy', () => {
    const terminal = terminalMock()
    const writeText = vi.fn()
    const controller = createTerminalClipboardController({
      terminal,
      platform: 'Linux',
      readText: async () => '',
      writeText,
      enqueuePaste: vi.fn(async () => ({ status: 'accepted' as const })),
      onError: vi.fn(),
    })

    expect(controller.handleKey(keyEvent({ key: 'c', ctrlKey: true }))).toBe(false)
    expect(writeText).toHaveBeenCalledWith('selected output')
    expect(terminal.clearSelection).toHaveBeenCalledOnce()

    vi.mocked(terminal.clearSelection).mockClear()
    expect(controller.handleKey(keyEvent({ key: 'c', ctrlKey: true, shiftKey: true }))).toBe(false)
    expect(terminal.clearSelection).not.toHaveBeenCalled()
  })

  it('preserves selection for Command+C and when the host copy fails', () => {
    const macTerminal = terminalMock()
    const macController = createTerminalClipboardController({
      terminal: macTerminal,
      platform: 'MacIntel',
      readText: async () => '',
      writeText: vi.fn(),
      enqueuePaste: vi.fn(async () => ({ status: 'accepted' as const })),
      onError: vi.fn(),
    })
    macController.handleKey(keyEvent({ key: 'c', metaKey: true }))
    expect(macTerminal.clearSelection).not.toHaveBeenCalled()

    const failedTerminal = terminalMock()
    const onError = vi.fn()
    const failedController = createTerminalClipboardController({
      terminal: failedTerminal,
      platform: 'Linux',
      readText: async () => '',
      writeText: () => {
        throw new Error('clipboard denied')
      },
      enqueuePaste: vi.fn(async () => ({ status: 'accepted' as const })),
      onError,
    })
    failedController.handleKey(keyEvent({ key: 'c', ctrlKey: true }))
    expect(failedTerminal.clearSelection).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledOnce()
  })

  it('delegates the entire async paste operation to the runtime dispatcher', async () => {
    const terminal = terminalMock(true)
    const delivered: string[] = []
    const enqueuePaste = vi.fn(async (resolveData: () => Promise<string>) => {
      delivered.push(await resolveData())
      return { status: 'accepted' as const }
    })
    const controller = createTerminalClipboardController({
      terminal,
      platform: 'Linux',
      readText: async () => 'one\ntwo',
      writeText: vi.fn(),
      enqueuePaste,
      onError: vi.fn(),
    })

    await controller.paste()

    expect(enqueuePaste).toHaveBeenCalledOnce()
    expect(delivered).toEqual(['\u001b[200~one\rtwo\u001b[201~'])
    expect(terminal.focus).toHaveBeenCalledOnce()
  })
})
