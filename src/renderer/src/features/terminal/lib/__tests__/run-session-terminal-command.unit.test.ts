import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTerminalStore } from '../../state/terminal-store'
import {
  COMMAND_START_GRACE_MS,
  runSessionTerminalCommand,
  watchSessionTerminalCommand,
} from '../run-session-terminal-command'
import { terminalInputDispatcher } from '../terminal-input-dispatcher'

vi.mock('@/shell/workspace-panel-actions', () => ({ showWorkspaceSideTerminal: vi.fn() }))

const SESSION_ID = 'session-a'

describe('runSessionTerminalCommand', () => {
  beforeEach(() => {
    useTerminalStore.setState({ groups: {}, activity: {}, portPreviews: {}, exits: {} })
  })

  it('opens a fresh named terminal tab in the Session and queues the command', () => {
    useTerminalStore.getState().createTerminal(SESSION_ID, '/repo')

    const terminalId = runSessionTerminalCommand({
      ownerKey: SESSION_ID,
      cwd: '/repo',
      command: 'gh auth login --hostname github.com',
      title: 'Sign in · github.com',
    })

    const group = useTerminalStore.getState().groups[SESSION_ID]
    expect(group?.panelOpen).toBe(true)
    expect(group?.tabs).toHaveLength(2)
    expect(group?.tabs.at(-1)).toMatchObject({
      customName: 'Sign in · github.com',
      activePaneId: terminalId,
    })
    expect(group?.activeTabId).toBe(group?.tabs.at(-1)?.id)
    const client = terminalInputDispatcher.acquire(SESSION_ID, terminalId ?? '')
    expect(client.snapshot().queuedChunks).toBeGreaterThan(0)
    client.release()
  })

  it('refuses without a Session terminal owner', () => {
    expect(
      runSessionTerminalCommand({ ownerKey: '', cwd: '/repo', command: 'gh', title: 'x' }),
    ).toBe(null)
  })
})

describe('watchSessionTerminalCommand', () => {
  beforeEach(() => {
    useTerminalStore.setState({ groups: {}, activity: {}, portPreviews: {}, exits: {} })
  })

  it('reports once when the command stops running in the foreground', () => {
    const onFinished = vi.fn()
    watchSessionTerminalCommand(SESSION_ID, 'terminal-1', onFinished)
    const store = useTerminalStore.getState()

    store.applyRuntimeEvent(SESSION_ID, 'terminal-1', { type: 'activity', processName: null })
    expect(onFinished).not.toHaveBeenCalled()
    store.applyRuntimeEvent(SESSION_ID, 'terminal-1', { type: 'activity', processName: 'gh' })
    expect(onFinished).not.toHaveBeenCalled()
    store.applyRuntimeEvent(SESSION_ID, 'terminal-1', { type: 'activity', processName: null })
    store.applyRuntimeEvent(SESSION_ID, 'terminal-1', { type: 'activity', processName: 'gh' })
    store.applyRuntimeEvent(SESSION_ID, 'terminal-1', { type: 'activity', processName: null })
    expect(onFinished).toHaveBeenCalledOnce()
  })

  it('reports when the shell exits and stops after unsubscribe', () => {
    const onFinished = vi.fn()
    const stop = watchSessionTerminalCommand(SESSION_ID, 'terminal-1', onFinished)
    useTerminalStore
      .getState()
      .applyRuntimeEvent(SESSION_ID, 'terminal-1', { type: 'exited', exitCode: 0 })
    expect(onFinished).toHaveBeenCalledOnce()

    const other = vi.fn()
    const stopOther = watchSessionTerminalCommand(SESSION_ID, 'terminal-2', other)
    stopOther()
    useTerminalStore
      .getState()
      .applyRuntimeEvent(SESSION_ID, 'terminal-2', { type: 'exited', exitCode: 0 })
    expect(other).not.toHaveBeenCalled()
    stop()
  })

  it('reports when the user closes the sign-in terminal', () => {
    const store = useTerminalStore.getState()
    const terminalId = store.createTerminal(SESSION_ID, '/repo') ?? ''
    const onFinished = vi.fn()
    watchSessionTerminalCommand(SESSION_ID, terminalId, onFinished)

    store.setPanelOpen(SESSION_ID, true)
    expect(onFinished).not.toHaveBeenCalled()
    store.closePane(SESSION_ID, terminalId)

    expect(onFinished).toHaveBeenCalledOnce()
  })

  it('reports a command that ended before the terminal ever sampled it', () => {
    vi.useFakeTimers()
    try {
      const onFinished = vi.fn()
      watchSessionTerminalCommand(SESSION_ID, 'terminal-1', onFinished)
      useTerminalStore
        .getState()
        .applyRuntimeEvent(SESSION_ID, 'terminal-1', { type: 'activity', processName: null })

      vi.advanceTimersByTime(COMMAND_START_GRACE_MS - 1)
      expect(onFinished).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1)
      expect(onFinished).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps waiting while the command it saw is still running', () => {
    vi.useFakeTimers()
    try {
      const onFinished = vi.fn()
      watchSessionTerminalCommand(SESSION_ID, 'terminal-1', onFinished)
      const store = useTerminalStore.getState()
      store.applyRuntimeEvent(SESSION_ID, 'terminal-1', { type: 'activity', processName: null })
      store.applyRuntimeEvent(SESSION_ID, 'terminal-1', { type: 'activity', processName: 'gh' })

      vi.advanceTimersByTime(COMMAND_START_GRACE_MS * 2)
      expect(onFinished).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
