import { SessionId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '@/features/chat/state'
import { useSessionStore } from '@/features/sessions/state'
import { useChatRouteEffects } from '../-chat-route-effects'
import { testRouterStatus as router } from './-chat-route-router-status'

vi.mock('@tanstack/react-router', async () => ({
  useNavigate: () => vi.fn(),
  useRouterState: (await import('./-chat-route-router-status')).useTestRouterState,
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    updateSessionTreeUiState: vi.fn().mockResolvedValue(undefined),
    getGitStatus: vi.fn(() => new Promise(() => {})),
    listGitBranches: vi.fn(() => new Promise(() => {})),
  },
}))

function sessionDetail(id: string): SessionDetail {
  return {
    id: SessionId(id),
    title: id,
    projectPath: '/project',
    messages: [],
    createdAt: 1,
    updatedAt: 2,
  }
}

describe('the chat store and the routed Session', () => {
  beforeEach(() => {
    router.set('idle')
    useChatStore.setState({
      draftSession: null,
      missingSessionIds: new Set(),
      sessionById: new Map(),
    })
    useSessionStore.setState({
      draftBranch: null,
      clearDraftBranchForSession: vi.fn(),
      showSessionWorkspace: vi.fn().mockResolvedValue(undefined),
    })
  })

  // PR 391 review R2 P3-8: with the store following the route only when the route moved, a
  // selection whose navigation was blocked, failed or never came left the store on another Session
  // than the URL for good.
  it('follows the route once a navigation settles with the store still elsewhere', async () => {
    const routed = SessionId('routed-session')
    const selected = SessionId('selected-session')
    const setActiveSession = vi.fn()
    useChatStore.setState({
      activeSessionId: routed,
      activeSession: sessionDetail('routed-session'),
      setActiveSession,
    })
    const props = { branchId: null, diffOpen: false, nodeId: null, sessionId: String(routed) }
    renderHook((input) => useChatRouteEffects(input), { initialProps: props })

    // Selected in the store; its navigation never lands on it.
    act(() => {
      useChatStore.setState({
        activeSessionId: selected,
        activeSession: sessionDetail('selected-session'),
      })
    })
    // A detail landing while it waits switches nothing back.
    act(() => useChatStore.setState({ activeSession: null }))
    expect(setActiveSession).not.toHaveBeenCalled()

    act(() => router.set('pending'))
    expect(setActiveSession).not.toHaveBeenCalled()
    act(() => router.set('idle'))

    await waitFor(() => expect(setActiveSession).toHaveBeenCalledWith(routed))
  })
})
