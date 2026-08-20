import { SessionId } from '@shared/types/brand'
import type { IpcEventChannelMap } from '@shared/types/ipc-events'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { type ShortcutBinding, shortcutBindingKey } from '@shared/types/shortcuts'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { usePreferencesStore } from '@/features/settings/state'
import { useUIStore } from '../ui-store'
import { useWorkspaceLifecycle } from '../useWorkspaceLifecycle'

type TitleUpdatedPayload = IpcEventChannelMap['sessions:title-updated']['payload']
type TitleUpdatedHandler = (payload: TitleUpdatedPayload) => void
interface HotkeyBinding {
  readonly hotkey: ShortcutBinding
  readonly callback: () => void
}

const lifecycleMocks = vi.hoisted(() => {
  let titleUpdatedHandler: TitleUpdatedHandler | null = null
  const titleUnsubscribe = vi.fn()
  const hotkeys: HotkeyBinding[] = []
  const singleHotkeys: { readonly hotkey: unknown; readonly callback: () => void }[] = []
  return {
    projectPath: '/repo',
    workingPath: '/repo/.worktrees/session-1',
    activeSessionId: 'session-1',
    loadChatSessions: vi.fn().mockResolvedValue(undefined),
    startDraftSession: vi.fn(),
    refreshSession: vi.fn().mockResolvedValue(undefined),
    updateSessionTitle: vi.fn(),
    loadSessionTrees: vi.fn().mockResolvedValue(undefined),
    refreshSessionTree: vi.fn().mockResolvedValue(undefined),
    refreshGitStatus: vi.fn().mockResolvedValue(undefined),
    refreshGitBranches: vi.fn().mockResolvedValue(undefined),
    navigate: vi.fn(),
    toggleDiff: vi.fn(),
    toggleSessionTree: vi.fn(),
    useGitRefresh: vi.fn(),
    useSessionStatusMonitor: vi.fn(),
    titleUnsubscribe,
    hotkeys,
    singleHotkeys,
    getTitleUpdatedHandler: () => titleUpdatedHandler,
    onSessionTitleUpdated: vi.fn((handler: TitleUpdatedHandler) => {
      titleUpdatedHandler = handler
      return titleUnsubscribe
    }),
  }
})

vi.mock('@tanstack/react-hotkeys', () => ({
  useHotkeys: (bindings: readonly HotkeyBinding[]) => {
    lifecycleMocks.hotkeys.length = 0
    lifecycleMocks.singleHotkeys.length = 0
    lifecycleMocks.hotkeys.push(...bindings)
  },
  /*
   * Single registrations are collected separately.
   *
   * The sidebar's Mod+F and the shared Escape hook register one at a time, and folding them into
   * the same array would have them cleared by the workspace's own useHotkeys call, or clear it.
   */
  useHotkey: (hotkey: unknown, callback: () => void) => {
    lifecycleMocks.singleHotkeys.push({ hotkey, callback })
  },
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => lifecycleMocks.navigate,
  // The sidebar's filter shortcut reads the route to know whether the sidebar can take focus.
  useLocation: () => ({ pathname: '/' }),
}))

vi.mock('@/features/chat/hooks', () => ({
  useChat: () => ({
    activeSessionId: lifecycleMocks.activeSessionId,
    startDraftSession: lifecycleMocks.startDraftSession,
    loadSessions: lifecycleMocks.loadChatSessions,
    refreshSession: lifecycleMocks.refreshSession,
    updateSessionTitle: lifecycleMocks.updateSessionTitle,
  }),
}))

vi.mock('@/features/diff-panel/hooks', () => ({
  useDiffRouteNavigation: () => ({
    toggleDiff: lifecycleMocks.toggleDiff,
    toggleSessionTree: lifecycleMocks.toggleSessionTree,
  }),
}))

vi.mock('@/features/git/hooks', () => ({
  useGit: () => ({
    refreshStatus: lifecycleMocks.refreshGitStatus,
    refreshBranches: lifecycleMocks.refreshGitBranches,
    // Status follows the session's working tree; the branch list is repository-level.
    workingPath: lifecycleMocks.workingPath,
    repositoryPath: lifecycleMocks.projectPath,
  }),
  useGitRefresh: lifecycleMocks.useGitRefresh,
}))

vi.mock('@/features/sessions/hooks', () => ({
  useProject: () => ({ projectPath: lifecycleMocks.projectPath }),
  useSessions: () => ({
    loadSessions: lifecycleMocks.loadSessionTrees,
    refreshSessionTree: lifecycleMocks.refreshSessionTree,
    // Pinned shortcuts map positions over the session list (issue #97).
    sessions: [],
  }),
  useSessionStatusMonitor: lifecycleMocks.useSessionStatusMonitor,
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    onSessionTitleUpdated: lifecycleMocks.onSessionTitleUpdated,
  },
}))

function runHotkey(hotkey: string) {
  const binding = lifecycleMocks.hotkeys.find(
    (candidate) => shortcutBindingKey(candidate.hotkey) === hotkey,
  )
  if (!binding) throw new Error(`Expected hotkey ${hotkey}`)
  binding.callback()
}

describe('useWorkspaceLifecycle', () => {
  beforeEach(() => {
    useUIStore.setState({ sidebarOpen: true, terminalOpen: false, slashCommandMenuOpen: false })
    usePreferencesStore.setState({
      settings: { ...DEFAULT_SETTINGS, projectPath: '/repo' },
      isLoaded: true,
      loadError: null,
    })
    lifecycleMocks.loadChatSessions.mockClear()
    lifecycleMocks.startDraftSession.mockClear()
    lifecycleMocks.loadSessionTrees.mockClear()
    lifecycleMocks.refreshGitStatus.mockClear()
    lifecycleMocks.refreshGitBranches.mockClear()
    lifecycleMocks.refreshSessionTree.mockClear()
    lifecycleMocks.updateSessionTitle.mockClear()
    lifecycleMocks.navigate.mockClear()
    lifecycleMocks.toggleDiff.mockClear()
    lifecycleMocks.toggleSessionTree.mockClear()
    lifecycleMocks.useGitRefresh.mockClear()
    lifecycleMocks.useSessionStatusMonitor.mockClear()
    lifecycleMocks.onSessionTitleUpdated.mockClear()
    lifecycleMocks.titleUnsubscribe.mockClear()
    lifecycleMocks.hotkeys.length = 0
  })

  it('loads app data, subscribes to title updates, refreshes project state, and registers hotkeys', async () => {
    const { unmount } = renderHook(() => useWorkspaceLifecycle())

    await waitFor(() => expect(lifecycleMocks.loadChatSessions).toHaveBeenCalledOnce())
    expect(lifecycleMocks.loadSessionTrees).toHaveBeenCalledOnce()
    // Status must target the session's worktree, not the opened checkout (ADR 0018).
    expect(lifecycleMocks.refreshGitStatus).toHaveBeenCalledWith('/repo/.worktrees/session-1')
    expect(lifecycleMocks.refreshGitBranches).toHaveBeenCalledWith('/repo')
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

    act(() => runHotkey('Mod+J'))
    act(() => runHotkey('Mod+B'))
    act(() => runHotkey('Mod+D'))
    act(() => runHotkey('Mod+Shift+Y'))
    act(() => runHotkey('Mod+K'))
    expect(useUIStore.getState().commandSurface).toBe('commands')
    act(() => runHotkey('Mod+P'))
    expect(useUIStore.getState().commandSurface).toBe('files')
    act(() => runHotkey('Mod+N'))
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
})
