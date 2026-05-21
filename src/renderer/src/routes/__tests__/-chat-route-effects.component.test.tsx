import { SessionBranchId, SessionId, SessionNodeId, SupportedModelId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useBranchSummaryStore, useChatStore } from '@/features/chat/state'
import { useGitStore } from '@/features/git/state'
import { useSessionStatusStore, useSessionStore } from '@/features/sessions/state'
import { usePreferencesStore } from '@/features/settings/state'
import { useChatRouteEffects } from '../-chat-route-effects'

const navigateMock = vi.hoisted(() => vi.fn())

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
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
