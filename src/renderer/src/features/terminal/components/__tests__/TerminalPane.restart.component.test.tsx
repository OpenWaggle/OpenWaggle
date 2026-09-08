import { TERMINAL } from '@shared/constants/resource-limits'
import type { TerminalAttachResult } from '@shared/types/terminal'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useTerminalStore } from '../../state/terminal-store'
import {
  getTerminalPaneMocks,
  OWNER,
  renderPane,
  resetTerminalPaneHarness,
  TERMINAL_ID,
} from './terminal-pane-test-harness'

const mocks = getTerminalPaneMocks()

describe('TerminalPane attach and restart lifecycle', () => {
  beforeEach(resetTerminalPaneHarness)

  it('synchronizes the PTY geometry after an asynchronous attach completes', async () => {
    const open = Promise.withResolvers<TerminalAttachResult>()
    mocks.openTerminal.mockReturnValueOnce(open.promise)
    renderPane()

    await waitFor(() => expect(mocks.openTerminal).toHaveBeenCalledOnce())
    expect(mocks.resizeTerminal).not.toHaveBeenCalled()

    open.resolve({
      history: '',
      outputBytes: 0,
      outputGeneration: 1,
      readiness: { phase: 'ready', generation: 1 },
      running: true,
      processName: null,
      ports: [],
      projectActionPending: false,
    })

    await waitFor(() =>
      expect(mocks.resizeTerminal).toHaveBeenCalledWith(
        OWNER,
        TERMINAL_ID,
        TERMINAL.DEFAULT_COLS,
        TERMINAL.DEFAULT_ROWS,
      ),
    )
  })

  it('synchronizes the PTY geometry after an asynchronous restart completes', async () => {
    const restart = Promise.withResolvers<TerminalAttachResult>()
    mocks.restartTerminal.mockReturnValueOnce(restart.promise)
    renderPane({ cwd: '/tmp/original', defaultCwd: '/tmp/session-worktree' })

    await waitFor(() => expect(mocks.resizeTerminal).toHaveBeenCalledOnce())
    mocks.resizeTerminal.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Restart in worktree' }))
    await waitFor(() => expect(mocks.restartTerminal).toHaveBeenCalledOnce())
    expect(mocks.resizeTerminal).not.toHaveBeenCalled()

    restart.resolve({
      history: '',
      outputBytes: 0,
      outputGeneration: 2,
      readiness: { phase: 'ready', generation: 2 },
      running: true,
      processName: null,
      ports: [],
      projectActionPending: false,
    })

    await waitFor(() =>
      expect(mocks.resizeTerminal).toHaveBeenCalledWith(
        OWNER,
        TERMINAL_ID,
        TERMINAL.DEFAULT_COLS,
        TERMINAL.DEFAULT_ROWS,
      ),
    )
  })

  it('restarts an inherited terminal in the session worktree after impact review', async () => {
    mocks.assessTerminalClose.mockResolvedValue({
      disposition: 'confirm',
      reason: 'active',
      processNames: ['node'],
      ports: [3000],
    })
    renderPane({ cwd: '/tmp/original', defaultCwd: '/tmp/session-worktree' })
    fireEvent.click(await screen.findByRole('button', { name: 'Restart in worktree' }))

    await waitFor(() => expect(mocks.showConfirm).toHaveBeenCalledOnce())
    await waitFor(() =>
      expect(mocks.restartTerminal).toHaveBeenCalledWith(
        expect.objectContaining({ cwd: '/tmp/session-worktree' }),
      ),
    )
  })

  it('keeps the live pane attached when restart is rejected', async () => {
    const restart = Promise.withResolvers<never>()
    mocks.restartTerminal.mockReturnValueOnce(restart.promise)
    renderPane({ cwd: '/tmp/original', defaultCwd: '/tmp/session-worktree' })
    await waitFor(() => expect(mocks.openTerminal).toHaveBeenCalledOnce())

    fireEvent.click(screen.getByRole('button', { name: 'Restart in worktree' }))
    await waitFor(() => expect(mocks.restartTerminal).toHaveBeenCalledOnce())
    const handler = mocks.getEventHandler()
    if (handler === null) throw new Error('Expected terminal event handler')
    act(() => {
      handler({
        ownerKey: OWNER,
        terminalId: TERMINAL_ID,
        event: {
          type: 'output',
          data: 'output-during-restart',
          outputGeneration: 1,
          startOffset: 0,
          endOffset: 21,
        },
      })
    })
    expect(mocks.terminalInstances[0]?.write).not.toHaveBeenCalledWith('output-during-restart')
    await act(async () => restart.reject(new Error('shutdown was not confirmed')))
    await waitFor(() =>
      expect(mocks.terminalInstances[0]?.write).toHaveBeenCalledWith(
        'output-during-restart',
        expect.any(Function),
      ),
    )
    act(() => mocks.emitInput('still-live'))

    await waitFor(() =>
      expect(mocks.writeTerminal).toHaveBeenCalledWith(
        OWNER,
        TERMINAL_ID,
        'still-live',
        expect.objectContaining({ generation: expect.any(String) }),
      ),
    )
    expect(useTerminalStore.getState().groups[OWNER]).toBeUndefined()
  })

  it('updates project action environment variables when moving into the worktree', async () => {
    useTerminalStore.getState().ensureTerminal(OWNER, TERMINAL_ID, '/tmp/project', {
      launchEnv: {
        OPENWAGGLE_PROJECT_ROOT: '/tmp/project',
        T3CODE_PROJECT_ROOT: '/tmp/project',
      },
    })
    renderPane({
      cwd: '/tmp/project',
      defaultCwd: '/tmp/project/.openwaggle/session-1',
      launchEnv: {
        OPENWAGGLE_PROJECT_ROOT: '/tmp/project',
        T3CODE_PROJECT_ROOT: '/tmp/project',
      },
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Restart in worktree' }))

    const expectedEnv = {
      OPENWAGGLE_PROJECT_ROOT: '/tmp/project',
      OPENWAGGLE_WORKTREE_PATH: '/tmp/project/.openwaggle/session-1',
      T3CODE_PROJECT_ROOT: '/tmp/project',
      T3CODE_WORKTREE_PATH: '/tmp/project/.openwaggle/session-1',
    }
    await waitFor(() =>
      expect(mocks.restartTerminal).toHaveBeenCalledWith(
        expect.objectContaining({
          cwd: '/tmp/project/.openwaggle/session-1',
          env: expectedEnv,
        }),
      ),
    )
    expect(useTerminalStore.getState().groups[OWNER]?.tabs[0]?.panes[0]?.launchEnv).toEqual(
      expectedEnv,
    )
  })
})
