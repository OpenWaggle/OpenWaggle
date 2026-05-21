import { SessionId } from '@shared/types/brand'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useDiffRouteNavigation } from '../useDiffRouteNavigation'

type RightPanel = 'diff' | 'session-tree'
interface RouterSearch {
  readonly branch?: string
  readonly diff?: number
  readonly node?: string
  readonly panel?: RightPanel
}
interface RouterState {
  readonly location: {
    readonly pathname: string
    readonly search: RouterSearch
  }
}
interface ShellState {
  readonly setLastRightSidebarPanel: (panel: RightPanel) => void
}
interface ChatState {
  readonly activeSessionId: SessionId | null
}

const routeMock = vi.hoisted(() => {
  let state: RouterState = { location: { pathname: '/', search: {} } }
  let activeSessionId: SessionId | null = null
  const setLastRightSidebarPanel = vi.fn()
  return {
    navigate: vi.fn(),
    setRoute: (nextState: RouterState) => {
      state = nextState
    },
    setActiveSessionId: (nextSessionId: SessionId | null) => {
      activeSessionId = nextSessionId
    },
    routerState: () => state,
    chatState: (): ChatState => ({ activeSessionId }),
    shellState: (): ShellState => ({ setLastRightSidebarPanel }),
    setLastRightSidebarPanel,
  }
})

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => routeMock.navigate,
  useRouterState: <T,>(input: { readonly select: (state: RouterState) => T }) =>
    input.select(routeMock.routerState()),
}))

vi.mock('@/features/chat/state', () => ({
  useChatStore: <T,>(selector: (state: ChatState) => T) => selector(routeMock.chatState()),
}))

vi.mock('@/shell/ui-store', () => ({
  useUIStore: <T,>(selector: (state: ShellState) => T) => selector(routeMock.shellState()),
}))

describe('useDiffRouteNavigation', () => {
  beforeEach(() => {
    routeMock.navigate.mockClear()
    routeMock.setLastRightSidebarPanel.mockClear()
    routeMock.setActiveSessionId(null)
    routeMock.setRoute({ location: { pathname: '/', search: {} } })
  })

  it('opens the Session Tree panel on the active session route while preserving branch search', () => {
    routeMock.setRoute({
      location: {
        pathname: '/sessions/session-1',
        search: { panel: 'diff', branch: 'branch-1', node: 'node-1' },
      },
    })
    const { result } = renderHook(() => useDiffRouteNavigation())

    act(() => result.current.toggleSessionTree())

    expect(result.current.diffOpen).toBe(true)
    expect(routeMock.setLastRightSidebarPanel).toHaveBeenCalledWith('session-tree')
    expect(routeMock.navigate).toHaveBeenCalledWith({
      to: '/sessions/$sessionId',
      params: { sessionId: 'session-1' },
      search: expect.any(Function),
    })
    const navigateCall = routeMock.navigate.mock.calls[0]
    const options = navigateCall?.[0]
    if (!options || typeof options.search !== 'function') {
      throw new Error('Expected search updater')
    }
    expect(options.search({ branch: 'branch-1', node: 'node-1', panel: 'diff' })).toEqual({
      branch: 'branch-1',
      node: 'node-1',
      diff: undefined,
      panel: 'session-tree',
    })
  })

  it('does not mutate route search outside chat routes', () => {
    routeMock.setRoute({ location: { pathname: '/settings', search: {} } })
    const { result } = renderHook(() => useDiffRouteNavigation())

    act(() => result.current.toggleDiff())

    expect(result.current.isChatRoute).toBe(false)
    expect(routeMock.navigate).not.toHaveBeenCalled()
  })

  it('opens diff on the root chat route when only an active session is known', () => {
    routeMock.setActiveSessionId(SessionId('active-session'))
    const { result } = renderHook(() => useDiffRouteNavigation())

    act(() => result.current.toggleDiff())

    expect(routeMock.navigate).toHaveBeenCalledWith({
      to: '/sessions/$sessionId',
      params: { sessionId: 'active-session' },
      search: expect.any(Function),
    })
  })
})
