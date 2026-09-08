import { SessionBranchId, SessionId, SessionNodeId, SupportedModelId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useBranchSummaryStore, useChatStore } from '@/features/chat/state'
import { useGitStore } from '@/features/git/state'
import { useSessionStatusStore, useSessionStore } from '@/features/sessions/state'
import { usePreferencesStore } from '@/features/settings/state'
import { api } from '@/shared/lib/ipc'
import { useChatRouteEffects } from '../-chat-route-effects'

const navigateMock = vi.hoisted(() => vi.fn())

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    updateSessionTreeUiState: vi.fn().mockResolvedValue(undefined),
    getGitStatus: vi.fn(() => new Promise(() => {})),
    listGitBranches: vi.fn(() => new Promise(() => {})),
  },
}))

function sessionDetail(id: string, projectPath: string): SessionDetail {
  return {
    id: SessionId(id),
    title: `Session ${id}`,
    projectPath,
    messages: [],
    createdAt: 1,
    updatedAt: 2,
  }
}

describe('useChatRouteEffects', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    navigateMock.mockClear()
    useBranchSummaryStore.getState().clearPrompt()
    useChatStore.setState({
      activeSessionId: null,
      activeSession: null,
      draftSession: null,
      missingSessionIds: new Set(),
      sessionById: new Map(),
      setActiveSession: vi.fn(),
    })
    useSessionStore.setState({
      activeWorkspace: null,
      draftBranch: null,
      clearDraftBranchForSession: vi.fn(),
      refreshSessionWorkspace: vi.fn().mockResolvedValue(undefined),
    })
    useSessionStatusStore.setState({
      statuses: new Map(),
      completedAt: new Map(),
      lastVisitedAt: new Map(),
    })
    usePreferencesStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        selectedModel: SupportedModelId('openai/gpt-5.5'),
        favoriteModels: [],
        enabledModels: [],
        projectPath: '/old-project',
        thinkingLevel: 'medium',
        recentProjects: [],
        skillTogglesByProject: {},
        projectDisplayNames: {},
      },
      setProjectPath: vi.fn().mockResolvedValue(undefined),
    })
    useGitStore.setState({
      refreshStatus: vi.fn().mockResolvedValue(undefined),
      refreshBranches: vi.fn().mockResolvedValue(undefined),
    })
  })

  it('does not repeat read receipts or Git reads when the Host echoes a visit as fresh Session detail', async () => {
    const session = sessionDetail('visited-session', '/project')
    useChatStore.setState({
      activeSessionId: session.id,
      activeSession: session,
      sessionById: new Map([[session.id, session]]),
    })
    useGitStore.setState({
      refreshStatus: useGitStore.getInitialState().refreshStatus,
      refreshBranches: useGitStore.getInitialState().refreshBranches,
    })
    const view = renderHook(() =>
      useChatRouteEffects({
        branchId: null,
        diffOpen: false,
        nodeId: null,
        sessionId: String(session.id),
      }),
    )

    // Each persisted read receipt broadcasts a Host session-list change. The shell
    // reloads Session detail and upserts a fresh DTO. Bound the old feedback loop.
    let echoedReceipts = 0
    for (let attempt = 0; attempt < 5; attempt += 1) {
      if (vi.mocked(api.updateSessionTreeUiState).mock.calls.length === echoedReceipts) break
      echoedReceipts += 1
      await act(async () => useChatStore.getState().upsertSession({ ...session }))
    }
    view.unmount()
    expect({
      receipts: vi.mocked(api.updateSessionTreeUiState).mock.calls.length,
      branchReads: vi.mocked(api.listGitBranches).mock.calls.length,
      statusReads: vi.mocked(api.getGitStatus).mock.calls.length,
    }).toEqual({ receipts: 1, branchReads: 1, statusReads: 1 })
  })

  it('preserves unread state across detail and diff updates, then marks the next visit', async () => {
    const first = sessionDetail('first', '/project')
    const second = sessionDetail('second', '/project')
    useChatStore.setState({
      activeSessionId: first.id,
      activeSession: first,
      sessionById: new Map([
        [first.id, first],
        [second.id, second],
      ]),
      setActiveSession: useChatStore.getInitialState().setActiveSession,
    })
    const props = { branchId: null, diffOpen: false, nodeId: null, sessionId: String(first.id) }
    const view = renderHook((input) => useChatRouteEffects(input), { initialProps: props })
    await act(async () => useSessionStatusStore.getState().markUnread(first.id))
    await act(async () => useChatStore.getState().upsertSession({ ...first, title: 'Renamed' }))
    view.rerender({ ...props, diffOpen: true })
    expect(useSessionStatusStore.getState().lastVisitedAt.get(first.id)).toBe(0)
    expect(api.updateSessionTreeUiState).toHaveBeenCalledTimes(2)

    view.rerender({ ...props, sessionId: String(second.id) })
    view.rerender(props)
    expect(useChatStore.getState().activeSessionId).toBe(first.id)
    expect(useSessionStatusStore.getState().lastVisitedAt.get(first.id)).toBeGreaterThan(0)
    expect(vi.mocked(api.updateSessionTreeUiState).mock.calls.map(([id]) => id)).toEqual([
      first.id,
      first.id,
      second.id,
      first.id,
    ])
  })

  it('refreshes changed working and repository paths without treating content updates as Git changes', async () => {
    const session = sessionDetail('path-session', '/project')
    useChatStore.setState({
      activeSessionId: session.id,
      activeSession: session,
      sessionById: new Map([[session.id, session]]),
    })
    renderHook(() =>
      useChatRouteEffects({
        branchId: null,
        diffOpen: false,
        nodeId: null,
        sessionId: String(session.id),
      }),
    )
    await act(async () => useChatStore.getState().upsertSession({ ...session, title: 'Renamed' }))
    expect(useGitStore.getState().refreshStatus).toHaveBeenCalledTimes(1)
    expect(useGitStore.getState().refreshBranches).toHaveBeenCalledTimes(1)

    await act(async () =>
      useChatStore.getState().upsertSession({
        ...session,
        environmentMode: 'worktree',
        worktreePath: '/project/worktree',
      }),
    )
    expect(useGitStore.getState().refreshStatus).toHaveBeenLastCalledWith('/project/worktree')
    await act(async () =>
      useChatStore.getState().upsertSession({
        ...session,
        projectPath: '/other-project',
      }),
    )
    expect(useGitStore.getState().refreshStatus).toHaveBeenLastCalledWith('/other-project')
    expect(useGitStore.getState().refreshBranches).toHaveBeenLastCalledWith('/other-project')
    expect(api.updateSessionTreeUiState).toHaveBeenCalledTimes(1)
  })

  it('redirects the root chat route back to the active session when no draft is active', async () => {
    useChatStore.setState({
      activeSessionId: SessionId('active-session'),
      activeSession: sessionDetail('active-session', '/project'),
    })

    renderHook(() =>
      useChatRouteEffects({ branchId: null, diffOpen: true, nodeId: null, sessionId: null }),
    )

    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith({
        to: '/sessions/$sessionId',
        params: { sessionId: 'active-session' },
        replace: true,
        search: { diff: 1 },
      }),
    )
  })

  it('activates route sessions, refreshes selected workspace, and syncs project/git context', async () => {
    const routeSessionId = SessionId('route-session')
    const routeBranchId = SessionBranchId('branch-1')
    const routeNodeId = SessionNodeId('node-1')
    const setActiveSession = vi.fn()
    const refreshSessionWorkspace = vi.fn().mockResolvedValue(undefined)
    const clearDraftBranchForSession = vi.fn()
    const setProjectPath = vi.fn().mockResolvedValue(undefined)
    const refreshStatus = vi.fn().mockResolvedValue(undefined)
    const refreshBranches = vi.fn().mockResolvedValue(undefined)

    useChatStore.setState({
      activeSessionId: SessionId('previous-session'),
      sessionById: new Map([[routeSessionId, sessionDetail('route-session', '/route-project')]]),
      setActiveSession,
    })
    useSessionStore.setState({
      draftBranch: { sessionId: routeSessionId, sourceNodeId: routeNodeId },
      clearDraftBranchForSession,
      refreshSessionWorkspace,
    })
    usePreferencesStore.setState({ setProjectPath })
    useGitStore.setState({ refreshStatus, refreshBranches })

    renderHook(() =>
      useChatRouteEffects({
        branchId: String(routeBranchId),
        diffOpen: false,
        nodeId: String(routeNodeId),
        sessionId: String(routeSessionId),
      }),
    )

    await waitFor(() => expect(setActiveSession).toHaveBeenCalledWith(routeSessionId))
    expect(useSessionStatusStore.getState().lastVisitedAt.has(routeSessionId)).toBe(true)
    expect(clearDraftBranchForSession).toHaveBeenCalledWith(routeSessionId)
    expect(refreshSessionWorkspace).toHaveBeenCalledWith(routeSessionId, {
      branchId: routeBranchId,
      nodeId: routeNodeId,
    })
    expect(setProjectPath).toHaveBeenCalledWith('/route-project')
    expect(refreshStatus).toHaveBeenCalledWith('/route-project')
    expect(refreshBranches).toHaveBeenCalledWith('/route-project')
  })
})
