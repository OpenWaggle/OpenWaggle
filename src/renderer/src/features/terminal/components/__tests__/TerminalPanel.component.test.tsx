import { TERMINAL } from '@shared/constants/resource-limits'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { DEFAULT_SHORTCUT_RULES } from '@shared/types/shortcuts'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { usePreferencesStore } from '@/features/settings/state'
import { useUIStore } from '@/shell/ui-store'
import { useTerminalStore } from '../../state/terminal-store'
import {
  DRAFT_OWNER,
  getTerminalPanelMocks,
  renderPanel,
  resetTerminalPanelHarness,
  seedGroup,
} from './terminal-panel-test-harness'

const mocks = getTerminalPanelMocks()

describe('TerminalPanel', () => {
  beforeEach(resetTerminalPanelHarness)

  it('shows the no-project empty state when no project is open', () => {
    renderPanel(null)

    expect(screen.getByText('Open a project to use the terminal')).toBeInTheDocument()
    expect(screen.queryByText('New terminal')).not.toBeInTheDocument()
  })

  it('renders the draft empty state with the default working path', () => {
    renderPanel()

    expect(screen.getByText('No terminal for this session yet')).toBeInTheDocument()
    expect(screen.getByText('/tmp/project-x')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'New terminal' }).length).toBeGreaterThan(0)
  })

  it('creates a terminal bound to the draft owner from the empty state', async () => {
    renderPanel()
    const emptyStateButton = screen
      .getAllByRole('button', { name: 'New terminal' })
      .find((button) => button.textContent === 'New terminal')
    if (emptyStateButton === undefined) throw new Error('Expected empty-state New terminal button')
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
    renderPanel()

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

  it('caps port preview chips and opens the selected URL', async () => {
    seedGroup([{ terminalId: 'term-1', cwd: '/tmp/project-x' }], {
      portPreviews: {
        [`${DRAFT_OWNER}::term-1`]: [3000, 5173, 8080, 9999].map((port) => ({
          host: 'localhost',
          port,
          url: `http://localhost:${String(port)}/`,
        })),
      },
    })
    renderPanel()

    expect(await screen.findAllByRole('button', { name: /:\d+ ↗/ })).toHaveLength(
      TERMINAL.MAX_PORT_PREVIEWS_SHOWN,
    )
    fireEvent.click(screen.getByTitle('Open http://localhost:5173/'))
    await waitFor(() => expect(mocks.openExternal).toHaveBeenCalledWith('http://localhost:5173/'))
  })

  it('reports a clear failure without removing the pane', async () => {
    seedGroup([{ terminalId: 'term-1', cwd: '/tmp/project-x' }])
    mocks.clearTerminal.mockRejectedValueOnce(new Error('history could not be cleared'))
    renderPanel()

    fireEvent.click(screen.getByRole('button', { name: 'Clear terminal' }))

    await waitFor(() =>
      expect(useUIStore.getState().toastData).toMatchObject({
        message: 'history could not be cleared',
        variant: 'error',
      }),
    )
    expect(useTerminalStore.getState().groups[DRAFT_OWNER]?.tabs).toHaveLength(1)
  })

  it('connects an open search to the addon registered by a newly selected tab', async () => {
    useTerminalStore.setState((state) => ({
      groups: {
        ...state.groups,
        [DRAFT_OWNER]: {
          tabs: [
            {
              id: 'tab-1',
              panes: [{ terminalId: 'term-1', cwd: '/tmp/project-x' }],
              activePaneId: 'term-1',
              splitDirection: 'side-by-side',
              customName: null,
            },
            {
              id: 'tab-2',
              panes: [{ terminalId: 'term-2', cwd: '/tmp/project-x' }],
              activePaneId: 'term-2',
              splitDirection: 'side-by-side',
              customName: null,
            },
          ],
          activeTabId: 'tab-1',
          panelOpen: true,
          panelHeight: 228,
        },
      },
    }))
    renderPanel()
    await waitFor(() => expect(mocks.searchAddonInstances).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: 'Search terminal' }))

    fireEvent.click(screen.getByRole('tab', { name: 'Terminal 2' }))
    await waitFor(() => expect(mocks.searchAddonInstances).toHaveLength(2))
    fireEvent.change(screen.getByRole('textbox', { name: 'Find in terminal' }), {
      target: { value: 'needle' },
    })

    expect(mocks.searchAddonInstances[0]?.findNext).not.toHaveBeenCalled()
    expect(mocks.searchAddonInstances[1]?.findNext).toHaveBeenCalledExactlyOnceWith('needle', {
      caseSensitive: false,
    })
  })

  it('clears search decorations when the query becomes empty', async () => {
    seedGroup([{ terminalId: 'term-1', cwd: '/tmp/project-x' }])
    renderPanel()
    await waitFor(() => expect(mocks.searchAddonInstances).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: 'Search terminal' }))
    const input = screen.getByRole('textbox', { name: 'Find in terminal' })

    fireEvent.change(input, { target: { value: 'needle' } })
    fireEvent.change(input, { target: { value: '' } })

    expect(mocks.searchAddonInstances[0]?.clearDecorations).toHaveBeenCalledOnce()
  })

  it('closes the pane shell with scrollback deletion', async () => {
    seedGroup([
      { terminalId: 'term-1', cwd: '/tmp/project-x' },
      { terminalId: 'term-2', cwd: '/tmp/project-x' },
    ])
    renderPanel()

    const closeButtons = await screen.findAllByRole('button', { name: 'Close pane' })
    expect(closeButtons).toHaveLength(2)
    const firstClose = closeButtons[0]
    if (firstClose === undefined) throw new Error('Expected a close pane button')
    fireEvent.click(firstClose)

    await waitFor(() =>
      expect(mocks.closeTerminal).toHaveBeenCalledWith(DRAFT_OWNER, 'term-1', true),
    )
    await waitFor(() => {
      const panes = useTerminalStore.getState().groups[DRAFT_OWNER]?.tabs[0]?.panes ?? []
      expect(panes.map((pane) => pane.terminalId)).toEqual(['term-2'])
    })
  })

  it('shows compact process and provenance identity only for split panes', async () => {
    seedGroup([
      { terminalId: 'term-1', cwd: '/tmp/project-x' },
      { terminalId: 'term-2', cwd: '/tmp/original-checkout' },
    ])
    useTerminalStore.setState((state) => ({
      activity: {
        ...state.activity,
        [`${DRAFT_OWNER}::term-1`]: 'zsh',
        [`${DRAFT_OWNER}::term-2`]: 'vite',
      },
    }))
    renderPanel()

    const identities = await screen.findAllByTestId('terminal-pane-identity')
    expect(identities).toHaveLength(2)
    expect(screen.getByText('zsh')).toBeInTheDocument()
    expect(screen.getByText('vite')).toBeInTheDocument()
    expect(screen.getByText('Draft checkout')).toBeInTheDocument()
    expect(screen.getAllByText('Original checkout').length).toBeGreaterThan(0)
    expect(screen.getByRole('region', { name: 'zsh pane 1' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'vite pane 2' })).toBeInTheDocument()

    act(() => useTerminalStore.getState().closePane(DRAFT_OWNER, 'term-2'))
    expect(screen.queryAllByTestId('terminal-pane-identity')).toHaveLength(0)
  })

  it('exposes resolved shortcut chords and the four-pane split limit in control metadata', () => {
    usePreferencesStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        shortcutBindings: {
          ...DEFAULT_SETTINGS.shortcutBindings,
          'terminal.new': { key: 'T', alt: true },
          'terminal.split': { key: 'K', ctrl: true },
        },
        shortcutRules: DEFAULT_SHORTCUT_RULES.map((rule) => {
          if (rule.command === 'terminal.new') {
            return { ...rule, shortcut: { key: 'T', alt: true } }
          }
          if (rule.command === 'terminal.split') {
            return { ...rule, shortcut: { key: 'K', ctrl: true } }
          }
          return rule
        }),
      },
    })
    seedGroup(
      Array.from({ length: TERMINAL.MAX_PANES_PER_TAB }, (_, index) => ({
        terminalId: `term-${String(index + 1)}`,
        cwd: '/tmp/project-x',
      })),
    )
    renderPanel()

    expect(screen.getByRole('button', { name: 'New terminal' })).toHaveAttribute(
      'title',
      'New terminal (Alt + T)',
    )
    expect(screen.getByRole('button', { name: 'New terminal' })).toHaveAttribute(
      'aria-keyshortcuts',
      'Alt+T',
    )
    const split = screen.getByRole('button', {
      name: `Split terminal side by side unavailable — maximum ${String(TERMINAL.MAX_PANES_PER_TAB)} panes`,
    })
    expect(split).toBeDisabled()
    expect(split).toHaveAttribute(
      'title',
      `Split terminal side by side unavailable — maximum ${String(TERMINAL.MAX_PANES_PER_TAB)} panes`,
    )
    expect(split).toHaveAttribute('aria-keyshortcuts', 'Control+K')
  })

  it('keeps an active pane until its impact confirmation succeeds', async () => {
    seedGroup([{ terminalId: 'term-1', cwd: '/tmp/project-x' }])
    mocks.assessTerminalClose.mockResolvedValue({
      disposition: 'confirm',
      reason: 'active',
      processNames: ['vite'],
      ports: [5173],
    })
    mocks.showConfirm.mockResolvedValue(false)

    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Close Terminal 1' }))

    await waitFor(() => expect(mocks.showConfirm).toHaveBeenCalledOnce())
    expect(mocks.showConfirm.mock.calls[0]?.[1]).toContain('Processes: vite')
    expect(mocks.showConfirm.mock.calls[0]?.[1]).toContain('Listening ports: 5173')
    expect(mocks.closeTerminal).not.toHaveBeenCalled()
    expect(useTerminalStore.getState().groups[DRAFT_OWNER]?.tabs).toHaveLength(1)
  })

  it('leaves configurable shortcut arbitration to the workspace-wide capture owner', () => {
    seedGroup([{ terminalId: 'term-1', cwd: '/tmp/project-x' }])
    renderPanel()
    const terminalPane = document.querySelector<HTMLElement>('[data-terminal-pane="term-1"]')
    if (terminalPane === null) throw new Error('Expected terminal pane')

    expect(
      fireEvent.keyDown(terminalPane, {
        key: 'd',
        code: 'KeyD',
        ctrlKey: true,
      }),
    ).toBe(true)
    expect(useTerminalStore.getState().groups[DRAFT_OWNER]?.tabs[0]?.panes).toHaveLength(1)
  })
})
