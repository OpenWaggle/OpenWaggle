import { TERMINAL } from '@shared/constants/resource-limits'
import type { TerminalOpenInput } from '@shared/types/terminal'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTerminalStore } from '../../state/terminal-store'
import { TerminalPanel } from '../TerminalPanel'

const mocks = vi.hoisted(() => {
  let projectPath: string | null = '/tmp/project-x'
  return {
    openTerminal: vi.fn(async (_input: TerminalOpenInput) => ({
      history: '',
      outputBytes: 0,
      running: true,
    })),
    restartTerminal: vi.fn(async (_input: TerminalOpenInput) => ({
      history: '',
      outputBytes: 0,
      running: true,
    })),
    closeTerminal: vi.fn(async () => undefined),
    openExternal: vi.fn(async () => undefined),
    get projectPath() {
      return projectPath
    },
    setProjectPath(value: string | null) {
      projectPath = value
    },
  }
})

vi.mock('@/features/chat/hooks', () => ({
  useChat: () => ({ activeSession: null }),
}))

vi.mock('@/features/sessions/hooks', () => ({
  useProject: () => ({ projectPath: mocks.projectPath }),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    openTerminal: mocks.openTerminal,
    detachTerminal: vi.fn(async () => undefined),
    resizeTerminal: vi.fn(async () => undefined),
    clearTerminal: vi.fn(async () => undefined),
    restartTerminal: mocks.restartTerminal,
    closeTerminal: mocks.closeTerminal,
    writeTerminal: vi.fn(),
    openExternal: mocks.openExternal,
    onTerminalEvent: vi.fn(() => () => undefined),
  },
}))

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = TERMINAL.DEFAULT_COLS
    rows = TERMINAL.DEFAULT_ROWS
    options: Record<string, unknown> = {}
    dispose() {}
    loadAddon() {}
    onData() {
      return { dispose: () => undefined }
    }
    open() {}
    write() {}
    reset() {}
    focus() {}
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

const DRAFT_OWNER = 'draft:/tmp/project-x'

function seedGroup(
  panes: { terminalId: string; cwd: string }[],
  extra: { exits?: Record<string, number>; portPreviews?: Record<string, number[]> } = {},
) {
  useTerminalStore.setState((state) => ({
    groups: {
      ...state.groups,
      [DRAFT_OWNER]: {
        tabs: [
          {
            id: 'tab-1',
            panes,
            splitDirection: 'side-by-side',
            customName: null,
          },
        ],
        activeTabId: 'tab-1',
      },
    },
    ...extra,
  }))
}

describe('TerminalPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // jsdom has no FontFaceSet; the pane session observes font loads.
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: new EventTarget(),
    })
    mocks.setProjectPath('/tmp/project-x')
    mocks.openTerminal.mockResolvedValue({ history: '', outputBytes: 0, running: true })
    mocks.restartTerminal.mockResolvedValue({ history: '', outputBytes: 0, running: true })
    useTerminalStore.setState({
      groups: {},
      activity: {},
      portPreviews: {},
      exits: {},
      panelHeight: 228,
    })
  })

  it('shows the no-project empty state when no project is open', () => {
    mocks.setProjectPath(null)

    render(<TerminalPanel onClose={vi.fn()} />)

    expect(screen.getByText('Open a project to use the terminal')).toBeInTheDocument()
    expect(screen.queryByText('New terminal')).not.toBeInTheDocument()
  })

  it('renders the draft empty state with the default working path', () => {
    render(<TerminalPanel onClose={vi.fn()} />)

    expect(screen.getByText('No terminal for this session yet')).toBeInTheDocument()
    expect(screen.getByText('/tmp/project-x')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'New terminal' }).length).toBeGreaterThan(0)
  })

  it('creates a terminal bound to the draft owner from the empty state', async () => {
    render(<TerminalPanel onClose={vi.fn()} />)
    // The header also exposes a "New terminal" action; the empty state owns one too.
    const emptyStateButton = screen
      .getAllByRole('button', { name: 'New terminal' })
      .find((button) => button.textContent === 'New terminal')
    if (!emptyStateButton) throw new Error('Expected empty-state New terminal button')
    fireEvent.click(emptyStateButton)

    await waitFor(() => expect(mocks.openTerminal).toHaveBeenCalledOnce())
    const input = mocks.openTerminal.mock.calls[0]?.[0]
    expect(input?.ownerKey).toBe(DRAFT_OWNER)
    expect(input?.cwd).toBe('/tmp/project-x')
    expect(typeof input?.terminalId).toBe('string')
  })

  it('shows the exit banner with restart for a dead shell', async () => {
    seedGroup([{ terminalId: 'term-1', cwd: '/tmp/project-x' }], {
      exits: { [`${DRAFT_OWNER}::term-1`]: 3 },
    })

    render(<TerminalPanel onClose={vi.fn()} />)

    expect(await screen.findByText('Shell exited (code 3)')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Restart' }))
    await waitFor(() => expect(mocks.restartTerminal).toHaveBeenCalledOnce())
    expect(mocks.restartTerminal.mock.calls[0]?.[0]).toMatchObject({
      ownerKey: DRAFT_OWNER,
      terminalId: 'term-1',
    })
    await waitFor(() =>
      expect(useTerminalStore.getState().exits[`${DRAFT_OWNER}::term-1`]).toBeUndefined(),
    )
  })

  it('renders port preview chips capped at the limit and opens them externally', async () => {
    seedGroup([{ terminalId: 'term-1', cwd: '/tmp/project-x' }], {
      portPreviews: { [`${DRAFT_OWNER}::term-1`]: [3000, 5173, 8080, 9999] },
    })

    render(<TerminalPanel onClose={vi.fn()} />)

    const chips = await screen.findAllByRole('button', { name: /:\d+ ↗/ })
    expect(chips).toHaveLength(TERMINAL.MAX_PORT_PREVIEWS_SHOWN)
    fireEvent.click(screen.getByTitle('Open http://localhost:5173'))
    await waitFor(() => expect(mocks.openExternal).toHaveBeenCalledWith('http://localhost:5173'))
  })

  it('closes the pane shell with scrollback deletion when a pane close is clicked', async () => {
    seedGroup([
      { terminalId: 'term-1', cwd: '/tmp/project-x' },
      { terminalId: 'term-2', cwd: '/tmp/project-x' },
    ])

    render(<TerminalPanel onClose={vi.fn()} />)

    const closeButtons = await screen.findAllByRole('button', { name: 'Close pane' })
    expect(closeButtons).toHaveLength(2)
    const firstClose = closeButtons[0]
    if (!firstClose) throw new Error('Expected a close pane button')
    fireEvent.click(firstClose)

    await waitFor(() =>
      expect(mocks.closeTerminal).toHaveBeenCalledWith(DRAFT_OWNER, 'term-1', true),
    )
    await waitFor(() => {
      const panes = useTerminalStore.getState().groups[DRAFT_OWNER]?.tabs[0]?.panes ?? []
      expect(panes.map((pane) => pane.terminalId)).toEqual(['term-2'])
    })
  })
})
