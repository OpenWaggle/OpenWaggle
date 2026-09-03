import { TERMINAL } from '@shared/constants/resource-limits'
import type { TerminalEventPayload } from '@shared/types/terminal'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTerminalStore } from '../../state/terminal-store'
import { TerminalPane } from '../TerminalPane'

const mocks = vi.hoisted(() => {
  const terminalInstances: {
    write: ReturnType<typeof vi.fn>
    reset: ReturnType<typeof vi.fn>
    dispose: ReturnType<typeof vi.fn>
    cols: number
    rows: number
  }[] = []
  let eventHandler: ((payload: TerminalEventPayload) => void) | null = null
  return {
    terminalInstances,
    getEventHandler: () => eventHandler,
    setEventHandler: (handler: (payload: TerminalEventPayload) => void) => {
      eventHandler = handler
    },
    emitTerminalEvent: (payload: TerminalEventPayload) => eventHandler?.(payload),
    openTerminal: vi.fn(),
    restartTerminal: vi.fn(),
    detachTerminal: vi.fn(),
    closeTerminal: vi.fn(),
    openExternal: vi.fn(),
  }
})

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    openTerminal: mocks.openTerminal,
    restartTerminal: mocks.restartTerminal,
    detachTerminal: mocks.detachTerminal,
    closeTerminal: mocks.closeTerminal,
    resizeTerminal: vi.fn(),
    clearTerminal: vi.fn(),
    writeTerminal: vi.fn(),
    openExternal: mocks.openExternal,
    onTerminalEvent: vi.fn((handler: (payload: TerminalEventPayload) => void) => {
      mocks.setEventHandler(handler)
      return () => undefined
    }),
  },
}))

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = TERMINAL.DEFAULT_COLS
    rows = TERMINAL.DEFAULT_ROWS
    options: Record<string, unknown> = {}
    write = vi.fn()
    reset = vi.fn()
    dispose = vi.fn()
    focus = vi.fn()

    constructor() {
      mocks.terminalInstances.push(this)
    }

    loadAddon() {}
    onData() {
      return { dispose: () => undefined }
    }
    open() {}
  },
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit() {}
    dispose() {}
  },
}))

vi.mock('@xterm/addon-search', () => ({
  SearchAddon: class {
    findNext() {}
    findPrevious() {}
    clearDecorations() {}
    dispose() {}
  },
}))

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: class {
    dispose() {}
  },
}))

vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: class {
    dispose() {}
  },
}))

const OWNER = 'draft:/tmp/project-x'
const TERMINAL_ID = 'term-1'
const runtimeKey = `${OWNER}::${TERMINAL_ID}`

function renderPane(props: Partial<Parameters<typeof TerminalPane>[0]> = {}) {
  return render(
    <TerminalPane
      ownerKey={props.ownerKey ?? OWNER}
      terminalId={props.terminalId ?? TERMINAL_ID}
      cwd={props.cwd ?? '/tmp/project-x'}
      focused={props.focused ?? true}
      onFocus={props.onFocus ?? (() => undefined)}
      onSearchAddon={props.onSearchAddon ?? (() => undefined)}
    />,
  )
}

describe('TerminalPane', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.terminalInstances.length = 0
    // jsdom has no FontFaceSet; the pane session observes font loads.
    Object.defineProperty(document, 'fonts', { configurable: true, value: new EventTarget() })
    mocks.openTerminal.mockResolvedValue({ history: '', running: true })
    mocks.restartTerminal.mockResolvedValue({ history: '', running: true })
    mocks.detachTerminal.mockResolvedValue(undefined)
    useTerminalStore.setState({
      groups: {},
      activity: {},
      portPreviews: {},
      exits: {},
      panelHeight: 228,
    })
  })

  it('replays attach history into the terminal', async () => {
    mocks.openTerminal.mockResolvedValue({ history: 'replay-text', running: true })

    renderPane()

    await waitFor(() => expect(mocks.openTerminal).toHaveBeenCalledOnce())
    expect(mocks.openTerminal.mock.calls[0]?.[0]).toMatchObject({
      ownerKey: OWNER,
      terminalId: TERMINAL_ID,
      cwd: '/tmp/project-x',
      cols: TERMINAL.DEFAULT_COLS,
      rows: TERMINAL.DEFAULT_ROWS,
    })
    await waitFor(() =>
      expect(mocks.terminalInstances[0]?.write).toHaveBeenCalledWith('replay-text'),
    )
  })

  it('shows the cwd-missing overlay when the working path vanished', async () => {
    mocks.openTerminal.mockResolvedValue({ history: '', running: false, cwdMissing: true })

    renderPane()

    expect(await screen.findByText('Working path no longer exists')).toBeInTheDocument()
    expect(screen.getByText('/tmp/project-x')).toBeInTheDocument()
  })

  it('shows the error overlay when opening fails', async () => {
    mocks.openTerminal.mockRejectedValue(new Error('pty exploded'))

    renderPane()

    expect(await screen.findByText('pty exploded')).toBeInTheDocument()
  })

  it('renders the exit banner from store state and restarts through the api', async () => {
    useTerminalStore.setState({ exits: { [runtimeKey]: 3 } })

    renderPane()

    expect(await screen.findByText('Shell exited (code 3)')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Restart' }))
    await waitFor(() => expect(mocks.restartTerminal).toHaveBeenCalledOnce())
    expect(mocks.restartTerminal.mock.calls[0]?.[0]).toMatchObject({
      ownerKey: OWNER,
      terminalId: TERMINAL_ID,
    })
    await waitFor(() => expect(useTerminalStore.getState().exits[runtimeKey]).toBeUndefined())
    expect(screen.queryByText(/Shell exited/)).not.toBeInTheDocument()
  })

  it('records runtime events for this pane through the terminal event subscription', async () => {
    renderPane()
    await waitFor(() => expect(mocks.getEventHandler()).not.toBeNull())

    const handler = mocks.getEventHandler()
    if (!handler) throw new Error('Expected terminal event handler')
    act(() => {
      handler({ ownerKey: OWNER, terminalId: TERMINAL_ID, event: { type: 'exited', exitCode: 9 } })
    })

    expect(useTerminalStore.getState().exits[runtimeKey]).toBe(9)
    expect(await screen.findByText('Shell exited (code 9)')).toBeInTheDocument()
  })

  it('renders port chips capped at the limit and opens them externally', async () => {
    useTerminalStore.setState({
      portPreviews: { [runtimeKey]: [3000, 5173, 8080, 9999] },
    })

    renderPane()

    const chips = await screen.findAllByRole('button', { name: /:\d+ ↗/ })
    expect(chips).toHaveLength(TERMINAL.MAX_PORT_PREVIEWS_SHOWN)
    fireEvent.click(screen.getByTitle('Open http://localhost:8080'))
    await waitFor(() => expect(mocks.openExternal).toHaveBeenCalledWith('http://localhost:8080'))
  })

  it('detaches instead of closing on unmount, keeping the shell alive', async () => {
    const view = renderPane()
    await waitFor(() => expect(mocks.openTerminal).toHaveBeenCalledOnce())

    view.unmount()

    expect(mocks.detachTerminal).toHaveBeenCalledExactlyOnceWith(OWNER, TERMINAL_ID)
    expect(mocks.closeTerminal).not.toHaveBeenCalled()
    expect(mocks.terminalInstances[0]?.dispose).toHaveBeenCalled()
  })

  describe('output offset gating', () => {
    const SNAPSHOT_OUTPUT_BYTES = 6

    async function renderPaneWithSnapshot() {
      mocks.openTerminal.mockResolvedValue({
        history: '',
        outputBytes: SNAPSHOT_OUTPUT_BYTES,
        running: true,
      })
      renderPane()
      await waitFor(() => expect(mocks.openTerminal).toHaveBeenCalledOnce())
      // The attach snapshot lands in a microtask after the open call resolves.
      await act(async () => {})
      const handler = mocks.getEventHandler()
      if (!handler) throw new Error('Expected terminal event handler')
      return handler
    }

    function emitOutput(
      handler: (payload: TerminalEventPayload) => void,
      data: string,
      startOffset: number,
      endOffset: number,
    ) {
      act(() => {
        handler({
          ownerKey: OWNER,
          terminalId: TERMINAL_ID,
          event: { type: 'output', data, startOffset, endOffset },
        })
      })
    }

    it('drops output entirely covered by the attach snapshot', async () => {
      const handler = await renderPaneWithSnapshot()

      emitOutput(handler, 'abcdef', 0, SNAPSHOT_OUTPUT_BYTES)

      expect(mocks.terminalInstances[0]?.write).not.toHaveBeenCalled()
    })

    it('writes only the suffix beyond the attach snapshot', async () => {
      const handler = await renderPaneWithSnapshot()

      emitOutput(handler, 'abcdef', 2, 8)

      expect(mocks.terminalInstances[0]?.write).toHaveBeenCalledExactlyOnceWith('ef')
    })

    it('writes output entirely beyond the attach snapshot', async () => {
      const handler = await renderPaneWithSnapshot()

      emitOutput(handler, 'xyz', SNAPSHOT_OUTPUT_BYTES, 9)

      expect(mocks.terminalInstances[0]?.write).toHaveBeenCalledExactlyOnceWith('xyz')
    })
  })
})
