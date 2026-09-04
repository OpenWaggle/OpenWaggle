// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const terminalMocks = vi.hoisted(() => ({
  fit: vi.fn(),
  closeTerminal: vi.fn(),
  createTerminal: vi.fn(async () => 'terminal-1'),
  resizeTerminal: vi.fn(),
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit = terminalMocks.fit
  },
}))

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80
    rows = 24
    options: Record<string, unknown>

    constructor(options: Record<string, unknown>) {
      this.options = options
    }

    dispose() {}
    loadAddon() {}
    onData() {
      return { dispose: () => undefined }
    }
    open() {}
    write() {}
  },
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    closeTerminal: terminalMocks.closeTerminal,
    createTerminal: terminalMocks.createTerminal,
    onTerminalData: () => () => undefined,
    resizeTerminal: terminalMocks.resizeTerminal,
    writeTerminal: vi.fn(),
  },
}))

import { useTerminalSession } from '../useTerminalSession'

function TerminalHarness() {
  const { containerRef } = useTerminalSession('/project')
  return <div ref={containerRef} />
}

describe('terminal typography geometry', () => {
  const fonts = new EventTarget()

  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(document, 'fonts', { configurable: true, value: fonts })
    vi.stubGlobal(
      'ResizeObserver',
      class {
        disconnect() {}
        observe() {}
      },
    )
  })

  afterEach(() => {
    document.documentElement.removeAttribute('style')
    vi.unstubAllGlobals()
  })

  it('refits and resizes the PTY after appearance and font-loading changes', async () => {
    const view = render(<TerminalHarness />)
    await vi.waitFor(() => expect(terminalMocks.resizeTerminal).toHaveBeenCalled())
    terminalMocks.fit.mockClear()
    terminalMocks.resizeTerminal.mockClear()

    document.documentElement.style.setProperty('--font-terminal-size', '18px')
    await vi.waitFor(() => {
      expect(terminalMocks.fit).toHaveBeenCalled()
      expect(terminalMocks.resizeTerminal).toHaveBeenCalledWith('terminal-1', 80, 24)
    })
    terminalMocks.fit.mockClear()
    terminalMocks.resizeTerminal.mockClear()

    fonts.dispatchEvent(new Event('loadingdone'))
    await vi.waitFor(() => {
      expect(terminalMocks.fit).toHaveBeenCalled()
      expect(terminalMocks.resizeTerminal).toHaveBeenCalledWith('terminal-1', 80, 24)
    })
    view.unmount()
  })
})
