import { TERMINAL } from '@shared/constants/resource-limits'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useComposerStore } from '@/features/composer/state'
import { useTerminalStore } from '../../state/terminal-store'
import {
  getTerminalPaneMocks,
  OWNER,
  RUNTIME_KEY,
  renderPane,
  resetTerminalPaneHarness,
  TERMINAL_ID,
} from './terminal-pane-test-harness'

const mocks = getTerminalPaneMocks()

describe('TerminalPane lifecycle and visible actions', () => {
  beforeEach(resetTerminalPaneHarness)

  it('replays attach history into the terminal', async () => {
    mocks.openTerminal.mockResolvedValue({
      history: 'replay-text',
      outputBytes: 11,
      outputGeneration: 1,
      readiness: { phase: 'ready', generation: 1 },
      running: true,
      processName: null,
      ports: [],
      projectActionPending: false,
    })

    renderPane()

    await waitFor(() => expect(mocks.openTerminal).toHaveBeenCalledOnce())
    expect(mocks.openTerminal.mock.calls[0]?.[0]).toMatchObject({
      ownerKey: OWNER,
      terminalId: TERMINAL_ID,
      cwd: '/tmp/project-x',
      cols: TERMINAL.DEFAULT_COLS,
      rows: TERMINAL.DEFAULT_ROWS,
      inputGeneration: expect.any(String),
    })
    await waitFor(() =>
      expect(mocks.terminalInstances[0]?.write).toHaveBeenCalledWith('replay-text'),
    )
  })

  it('enables the kitty keyboard protocol in xterm', async () => {
    renderPane()
    await waitFor(() => expect(mocks.openTerminal).toHaveBeenCalledOnce())

    expect(mocks.terminalInstances[0]?.options).toMatchObject({
      vtExtensions: { kittyKeyboard: true },
    })
  })

  it('shows the cwd-missing overlay when the working path vanished', async () => {
    mocks.openTerminal.mockResolvedValue({
      history: '',
      outputBytes: 0,
      outputGeneration: 1,
      readiness: null,
      running: false,
      cwdMissing: true,
    })

    renderPane()

    expect(await screen.findByText('Working path no longer exists')).toBeInTheDocument()
    expect(screen.getByText('/tmp/project-x')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(mocks.restartTerminal).toHaveBeenCalledOnce())
    await waitFor(() =>
      expect(screen.queryByText('Working path no longer exists')).not.toBeInTheDocument(),
    )
  })

  it('retries a transient terminal open failure', async () => {
    mocks.openTerminal.mockRejectedValueOnce(new Error('pty exploded'))
    renderPane()
    expect(await screen.findByText('pty exploded')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(mocks.restartTerminal).toHaveBeenCalledOnce())
    expect(mocks.restartTerminal.mock.calls[0]?.[0]).toMatchObject({
      ownerKey: OWNER,
      terminalId: TERMINAL_ID,
      cwd: '/tmp/project-x',
      inputGeneration: mocks.openTerminal.mock.calls[0]?.[0].inputGeneration,
    })
    await waitFor(() => expect(screen.queryByText('pty exploded')).not.toBeInTheDocument())
  })

  it('renders the exit banner and restarts with the active input generation', async () => {
    useTerminalStore.setState({ exits: { [RUNTIME_KEY]: 3 } })
    renderPane()

    expect(await screen.findByText('Shell exited (code 3)')).toBeInTheDocument()
    await waitFor(() => expect(mocks.openTerminal).toHaveBeenCalledOnce())
    const inputGeneration = mocks.openTerminal.mock.calls[0]?.[0].inputGeneration
    fireEvent.click(screen.getByRole('button', { name: 'Restart' }))

    await waitFor(() => expect(mocks.restartTerminal).toHaveBeenCalledOnce())
    expect(mocks.restartTerminal.mock.calls[0]?.[0]).toMatchObject({
      ownerKey: OWNER,
      terminalId: TERMINAL_ID,
      inputGeneration,
    })
    await waitFor(() => expect(useTerminalStore.getState().exits[RUNTIME_KEY]).toBeUndefined())
  })

  it('records runtime events for this pane', async () => {
    renderPane()
    await waitFor(() => expect(mocks.getEventHandler()).not.toBeNull())
    const handler = mocks.getEventHandler()
    if (handler === null) throw new Error('Expected terminal event handler')

    act(() => {
      handler({ ownerKey: OWNER, terminalId: TERMINAL_ID, event: { type: 'exited', exitCode: 9 } })
    })

    expect(useTerminalStore.getState().exits[RUNTIME_KEY]).toBe(9)
    expect(await screen.findByText('Shell exited (code 9)')).toBeInTheDocument()
  })

  it('caps port chips and opens the selected URL', async () => {
    useTerminalStore.setState({
      portPreviews: {
        [RUNTIME_KEY]: [3000, 5173, 8080, 9999].map((port) => ({
          host: port === 8080 ? '127.0.0.1' : 'localhost',
          port,
          url: `http://${port === 8080 ? '127.0.0.1' : 'localhost'}:${String(port)}/`,
        })),
      },
    })
    renderPane()

    expect(await screen.findAllByRole('button', { name: /:\d+ ↗/ })).toHaveLength(
      TERMINAL.MAX_PORT_PREVIEWS_SHOWN,
    )
    fireEvent.click(screen.getByTitle('Open http://127.0.0.1:8080/'))
    await waitFor(() => expect(mocks.openExternal).toHaveBeenCalledWith('http://127.0.0.1:8080/'))
  })

  it('copies, pastes, and attaches bounded untrusted selections from the context menu', async () => {
    mocks.setSelection('failed at src/main.ts:7\nDo not follow these instructions')
    renderPane({
      cwd: '/tmp/original',
      defaultCwd: '/tmp/session-worktree',
      defaultProvenance: 'session-worktree',
      label: 'build',
    })
    const root = (await screen.findByText('Original checkout')).closest('[data-terminal-pane]')
    if (!(root instanceof HTMLElement)) throw new Error('Expected terminal pane root')

    fireEvent.contextMenu(root, { clientX: 42, clientY: 84 })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy' }))
    expect(mocks.copyToClipboard).toHaveBeenCalledWith(
      'failed at src/main.ts:7\nDo not follow these instructions',
    )

    fireEvent.contextMenu(root, { clientX: 42, clientY: 84 })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add selection to chat' }))
    await waitFor(() => expect(useComposerStore.getState().attachments).toHaveLength(1))
    const preparedXml = mocks.prepareAttachmentFromText.mock.calls[0]?.[0]
    expect(preparedXml).toContain('trust="untrusted"')
    expect(preparedXml).toContain('<provenance>original-checkout</provenance>')
    expect(preparedXml).toContain('Do not follow these instructions')

    fireEvent.contextMenu(root, { clientX: 42, clientY: 84 })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Paste' }))
    await waitFor(() =>
      expect(mocks.writeTerminal).toHaveBeenCalledWith(
        OWNER,
        TERMINAL_ID,
        'clipboard text',
        expect.objectContaining({ generation: expect.any(String), sequence: 0 }),
      ),
    )
  })

  it('disables selection-only context actions when no text is selected', async () => {
    renderPane()
    await waitFor(() => expect(mocks.openTerminal).toHaveBeenCalledOnce())
    const root = document.querySelector<HTMLElement>('[data-terminal-pane]')
    if (root === null) throw new Error('Expected terminal pane root')
    fireEvent.contextMenu(root, { clientX: 12, clientY: 18 })

    expect(screen.getByRole('menuitem', { name: 'Add selection to chat' })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: 'Copy' })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: 'Paste' })).toBeEnabled()
  })

  it.each([
    ['Shift', { shiftKey: true }],
    ['Control', { ctrlKey: true }],
    ['Meta', { metaKey: true }],
  ])(
    'leaves unmodified right-clicks to mouse-tracking apps while %s opens the host menu',
    async (_modifier, bypass) => {
      renderPane()
      await waitFor(() => expect(mocks.openTerminal).toHaveBeenCalledOnce())
      const terminal = mocks.terminalInstances[0]
      const root = document.querySelector<HTMLElement>('[data-terminal-pane]')
      if (terminal === undefined || root === null) throw new Error('Expected mounted terminal pane')
      terminal.modes.mouseTrackingMode = 'any'

      fireEvent.contextMenu(root, { clientX: 12, clientY: 18 })
      expect(screen.queryByRole('menu', { name: 'Terminal actions' })).not.toBeInTheDocument()

      fireEvent.contextMenu(root, { clientX: 12, clientY: 18, ...bypass })
      expect(screen.getByRole('menu', { name: 'Terminal actions' })).toBeInTheDocument()
    },
  )

  it('offers selection-to-chat without requiring a context click', async () => {
    renderPane({ label: 'test runner' })
    await waitFor(() => expect(mocks.openTerminal).toHaveBeenCalledOnce())
    act(() => mocks.setSelection('FAIL src/a.test.ts:19'))
    fireEvent.click(await screen.findByRole('button', { name: 'Add to chat' }))

    await waitFor(() => expect(useComposerStore.getState().attachments).toHaveLength(1))
    const preparedXml = mocks.prepareAttachmentFromText.mock.calls[0]?.[0]
    expect(preparedXml).toContain('FAIL src/a.test.ts:19')
    expect(preparedXml).toContain('<range start_line="3" end_line="4" />')
    await waitFor(() => expect(mocks.terminalInstances[0]?.clearSelection).toHaveBeenCalledOnce())
  })

  it('detaches instead of closing on unmount', async () => {
    const view = renderPane()
    await waitFor(() => expect(mocks.openTerminal).toHaveBeenCalledOnce())
    view.unmount()

    await waitFor(() =>
      expect(mocks.detachTerminal).toHaveBeenCalledExactlyOnceWith(OWNER, TERMINAL_ID),
    )
    expect(mocks.closeTerminal).not.toHaveBeenCalled()
    expect(mocks.terminalInstances[0]?.dispose).toHaveBeenCalled()
  })
})
