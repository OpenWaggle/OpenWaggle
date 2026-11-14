import { SessionId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '@/features/chat/state'
import { useSessionStore } from '@/features/sessions/state'
import { usePreferencesStore } from '@/features/settings/state'
import { useChatRouteEffects } from '../-chat-route-effects'
import { testRouterStatus as router } from './-chat-route-router-status'

const loggerWarn = vi.hoisted(() => vi.fn())
vi.mock('@/shared/lib/logger', () => ({
  createRendererLogger: () => ({
    warn: loggerWarn,
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

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

function sessionDetail(id: string) {
  const detail: SessionDetail = {
    id: SessionId(id),
    title: id,
    projectPath: '/project',
    messages: [],
    createdAt: 1,
    updatedAt: 2,
  }
  return detail
}

function sessionDetailIn(projectPath: string) {
  return { ...sessionDetail('route-session'), projectPath }
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

  it('settles a failed project-path follow instead of floating its rejection', async () => {
    // The route fires setProjectPath with `void`, so a transient Settings IPC failure used to
    // surface as an unhandled renderer rejection (Sentry issue OPENWAGGLE-6). The store keeps
    // the previous project and the next route change retries the write.
    const routed = SessionId('route-session')
    const setProjectPath = vi
      .fn()
      .mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:443'))
    useChatStore.setState({
      activeSessionId: SessionId('previous-session'),
      sessionById: new Map([[routed, sessionDetailIn('/route-project')]]),
    })
    usePreferencesStore.setState({ setProjectPath })

    renderHook(() =>
      useChatRouteEffects({
        branchId: null,
        diffOpen: false,
        nodeId: null,
        sessionId: String(routed),
      }),
    )

    await waitFor(() => expect(setProjectPath).toHaveBeenCalledWith('/route-project'))
    await waitFor(() =>
      expect(loggerWarn).toHaveBeenCalledWith('Failed to follow the routed Session project', {
        error: expect.stringContaining('ECONNREFUSED'),
      }),
    )
  })
})
