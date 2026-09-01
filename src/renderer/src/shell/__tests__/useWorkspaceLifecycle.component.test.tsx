import { SessionId } from '@shared/types/brand'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useUIStore } from '../ui-store'
import {
  getWorkspaceLifecycleMocks,
  loadUseWorkspaceLifecycle,
  resetWorkspaceLifecycleMocks,
  runWorkspaceHotkey,
} from './useWorkspaceLifecycle.test-harness'

const lifecycleMocks = getWorkspaceLifecycleMocks()

describe('useWorkspaceLifecycle', () => {
  let useWorkspaceLifecycle: Awaited<
    ReturnType<typeof loadUseWorkspaceLifecycle>
  >['useWorkspaceLifecycle']

  beforeEach(async () => {
    resetWorkspaceLifecycleMocks()
    ;({ useWorkspaceLifecycle } = await loadUseWorkspaceLifecycle())
  })

  it('loads app data, subscribes to title updates, refreshes project state, and registers hotkeys', async () => {
    const { unmount } = renderHook(() => useWorkspaceLifecycle())

    await waitFor(() => expect(lifecycleMocks.loadChatSessions).toHaveBeenCalledOnce())
    expect(lifecycleMocks.loadSessionTrees).toHaveBeenCalledOnce()
    // Status must target the session's worktree, not the opened checkout (ADR 0018).
    expect(lifecycleMocks.refreshGitStatus).toHaveBeenCalledWith('/repo/.worktrees/session-1')
    expect(lifecycleMocks.refreshGitBranches).toHaveBeenCalledWith('/repo')
    expect(lifecycleMocks.loadSyntaxResources).toHaveBeenCalledWith('/repo/.worktrees/session-1')
    expect(lifecycleMocks.refreshSessionTree).toHaveBeenCalledWith(SessionId('session-1'))
    expect(lifecycleMocks.useGitRefresh).toHaveBeenCalledWith({
      workingPath: '/repo/.worktrees/session-1',
      repositoryPath: '/repo',
      activeSessionId: SessionId('session-1'),
      refreshGitStatus: lifecycleMocks.refreshGitStatus,
      refreshGitBranches: lifecycleMocks.refreshGitBranches,
      refreshSession: lifecycleMocks.refreshSession,
    })
    expect(lifecycleMocks.useSessionStatusMonitor).toHaveBeenCalledOnce()

    const titleHandler = lifecycleMocks.getTitleUpdatedHandler()
    if (!titleHandler) throw new Error('Expected title subscription')
    titleHandler({ sessionId: SessionId('session-1'), title: 'New title' })
    expect(lifecycleMocks.updateSessionTitle).toHaveBeenCalledWith(
      SessionId('session-1'),
      'New title',
    )

    act(() => runWorkspaceHotkey('Mod+J'))
    act(() => runWorkspaceHotkey('Mod+B'))
    act(() => runWorkspaceHotkey('Mod+D'))
    act(() => runWorkspaceHotkey('Mod+Shift+Y'))
    act(() => runWorkspaceHotkey('Mod+K'))
    expect(useUIStore.getState().commandSurface).toBe('commands')
    act(() => runWorkspaceHotkey('Mod+P'))
    expect(useUIStore.getState().commandSurface).toBe('files')
    act(() => runWorkspaceHotkey('Mod+N'))
    expect(useUIStore.getState().commandSurface).toBeNull()

    expect(useUIStore.getState().terminalOpen).toBe(true)
    expect(useUIStore.getState().sidebarOpen).toBe(false)
    expect(lifecycleMocks.startDraftSession).toHaveBeenCalledWith('/repo')
    expect(lifecycleMocks.navigate).toHaveBeenCalledWith({ to: '/' })
    expect(lifecycleMocks.toggleDiff).toHaveBeenCalledOnce()
    expect(lifecycleMocks.toggleSessionTree).toHaveBeenCalledOnce()

    unmount()
    expect(lifecycleMocks.titleUnsubscribe).toHaveBeenCalledOnce()
  })

  it('coalesces Host event bursts and ignores out-of-order cursors', async () => {
    renderHook(() => useWorkspaceLifecycle())
    await waitFor(() => expect(lifecycleMocks.loadChatSessions).toHaveBeenCalledOnce())
    lifecycleMocks.loadChatSessions.mockClear()
    lifecycleMocks.loadSessionTrees.mockClear()
    lifecycleMocks.refreshSession.mockClear()
    lifecycleMocks.refreshSessionTree.mockClear()
    lifecycleMocks.invalidateQueries.mockClear()

    const handler = lifecycleMocks.getSessionHostEventHandler()
    if (!handler) throw new Error('Expected Session Host event subscription')
    handler({
      cursor: { hostInstanceId: 'host-1', sequence: 2 },
      timestamp: 2,
      payload: {
        kind: 'session-state-changed',
        sessionId: 'session-1',
        stateRevision: 2,
        operation: 'queue-updated',
      },
    })
    handler({
      cursor: { hostInstanceId: 'host-1', sequence: 1 },
      timestamp: 1,
      payload: {
        kind: 'session-list-changed',
        sessionId: 'session-1',
        change: 'updated',
      },
    })
    handler({
      cursor: { hostInstanceId: 'host-1', sequence: 3 },
      timestamp: 3,
      payload: {
        kind: 'session-list-changed',
        sessionId: 'session-1',
        change: 'updated',
      },
    })

    await waitFor(() => expect(lifecycleMocks.loadSessionTrees).toHaveBeenCalledOnce())
    expect(lifecycleMocks.loadChatSessions).toHaveBeenCalledOnce()
    expect(lifecycleMocks.refreshSession).toHaveBeenCalledOnce()
    expect(lifecycleMocks.refreshSession).toHaveBeenCalledWith('session-1')
    expect(lifecycleMocks.refreshSessionTree).toHaveBeenCalledOnce()
    expect(lifecycleMocks.invalidateQueries).toHaveBeenCalledOnce()
  })

  it('refreshes transcripts only for the active Session and performs a guarded resync', async () => {
    renderHook(() => useWorkspaceLifecycle())
    await waitFor(() => expect(lifecycleMocks.loadChatSessions).toHaveBeenCalledOnce())
    lifecycleMocks.loadChatSessions.mockClear()
    lifecycleMocks.loadSessionTrees.mockClear()
    lifecycleMocks.refreshSession.mockClear()
    lifecycleMocks.refreshSessionTree.mockClear()

    const eventHandler = lifecycleMocks.getSessionHostEventHandler()
    const resyncHandler = lifecycleMocks.getSessionHostResyncHandler()
    if (!eventHandler || !resyncHandler) throw new Error('Expected Session Host subscriptions')
    eventHandler({
      cursor: { hostInstanceId: 'host-2', sequence: 1 },
      timestamp: 1,
      payload: {
        kind: 'session-list-changed',
        sessionId: 'session-2',
        change: 'updated',
      },
    })
    await waitFor(() => expect(lifecycleMocks.loadSessionTrees).toHaveBeenCalledOnce())
    expect(lifecycleMocks.refreshSession).not.toHaveBeenCalled()
    expect(lifecycleMocks.loadChatSessions).toHaveBeenCalledOnce()

    resyncHandler({ reason: 'slow-consumer' })
    await waitFor(() => expect(lifecycleMocks.loadSessionTrees).toHaveBeenCalledTimes(2))
    expect(lifecycleMocks.refreshSession).toHaveBeenCalledWith('session-1')
    expect(lifecycleMocks.refreshSessionTree).toHaveBeenCalledWith(SessionId('session-1'))
    expect(lifecycleMocks.loadChatSessions).toHaveBeenCalledTimes(2)
  })

  it('loads project syntax resources when direct review changes working trees', async () => {
    const { rerender } = renderHook(() => useWorkspaceLifecycle())

    await waitFor(() =>
      expect(lifecycleMocks.loadSyntaxResources).toHaveBeenCalledWith('/repo/.worktrees/session-1'),
    )

    lifecycleMocks.workingPath = '/repo/.worktrees/session-2'
    rerender()

    await waitFor(() =>
      expect(lifecycleMocks.loadSyntaxResources).toHaveBeenCalledWith('/repo/.worktrees/session-2'),
    )
  })
})
