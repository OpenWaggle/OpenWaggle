import { SessionId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '@/features/chat/state'
import { useSessionStore } from '@/features/sessions/state'
import { usePreferencesStore } from '@/features/settings/state'
import { useUIStore } from '@/shell/ui-store'

/*
 * Only the preload and the router's navigate are replaced: the chat, preferences and UI stores
 * are the real ones, so each case asserts the Session the app selects and the notice it shows.
 */
const mocks = vi.hoisted(() => {
  const listener: { current: (() => void) | null } = { current: null }
  const requests: (string | null)[] = []
  return {
    listener,
    requests,
    known: new Map<string, { id: string; archived?: boolean }>(),
    listSessionsByIds: vi.fn(),
    navigate: vi.fn(async (_options: unknown) => undefined),
    unsubscribe: vi.fn(),
  }
})

// A memory router would add a route tree for one navigate call; navigation is the outcome here.
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mocks.navigate }))
vi.mock('@/shared/lib/ipc', async () => ({
  api: (await import('@/test-utils/preload-api')).preloadApi({
    listSessionsByIds: mocks.listSessionsByIds,
    takeOpenSessionLinkRequest: async () => mocks.requests.shift() ?? null,
    onOpenSessionLinkRequested: (listener: () => void) => {
      mocks.listener.current = listener
      return mocks.unsubscribe
    },
    // Selecting a Session reads its detail, as the sidebar does.
    getSessionDetail: async (id: string): Promise<SessionDetail | null> =>
      mocks.known.has(id) ? sessionDetail(id) : null,
  }),
}))

const { useOpenSessionLinkRequests } = await import('../useOpenSessionLinkRequests')

function sessionDetail(id: string): SessionDetail {
  return {
    id: SessionId(id),
    title: id,
    projectPath: '/repo',
    messages: [],
    createdAt: 1,
    updatedAt: 1,
  }
}

const navigatedSessions = () =>
  mocks.navigate.mock.calls.map(([options]) =>
    typeof options === 'object' && options !== null && 'params' in options ? options.params : null,
  )
const activeSessionId = () => useChatStore.getState().activeSessionId
const toast = () => useUIStore.getState().toastData

function resetStores() {
  usePreferencesStore.setState({ ...usePreferencesStore.getInitialState(), isLoaded: true }, true)
  useChatStore.setState(useChatStore.getInitialState(), true)
  useSessionStore.setState(useSessionStore.getInitialState(), true)
  useUIStore.setState({ toastMessage: null, toastData: null })
}

beforeEach(() => {
  mocks.listener.current = null
  mocks.requests.length = 0
  mocks.known.clear()
  mocks.listSessionsByIds.mockReset().mockImplementation(async (ids: readonly string[]) =>
    ids.flatMap((id) => {
      const session = mocks.known.get(id)
      return session ? [{ ...session, id: SessionId(session.id) }] : []
    }),
  )
  mocks.navigate.mockClear()
  mocks.unsubscribe.mockClear()
  resetStores()
})
afterEach(resetStores)

describe('Session link requests', () => {
  it.each([
    ['a Session linked before the window loaded', { id: 'session-1' }],
    ['an archived Session without restoring it', { id: 'session-archived', archived: true }],
  ])('opens %s', async (_case, session) => {
    mocks.known.set(session.id, session)
    mocks.requests.push(session.id)

    renderHook(useOpenSessionLinkRequests)

    await vi.waitFor(() => expect(navigatedSessions()).toEqual([{ sessionId: session.id }]))
    expect(activeSessionId()).toBe(session.id)
    expect(toast()).toBeNull()
  })

  it('reports an unknown Session and stays on the current page', async () => {
    mocks.requests.push('session-missing')

    renderHook(useOpenSessionLinkRequests)

    await vi.waitFor(() =>
      expect(toast()).toMatchObject({
        message: 'Session not found: session-missing',
        variant: 'error',
      }),
    )
    expect(mocks.navigate).not.toHaveBeenCalled()
    expect(activeSessionId()).toBeNull()
  })

  it('opens links received while the app is running, one at a time', async () => {
    mocks.known.set('session-a', { id: 'session-a' })
    mocks.known.set('session-b', { id: 'session-b' })
    renderHook(useOpenSessionLinkRequests)
    await vi.waitFor(() => expect(mocks.listener.current).not.toBeNull())
    let finishFirst: () => void = () => undefined
    mocks.navigate.mockImplementationOnce(
      () => new Promise<undefined>((resolve) => (finishFirst = () => resolve(undefined))),
    )

    mocks.requests.push('session-a', 'session-b')
    act(() => {
      mocks.listener.current?.()
      mocks.listener.current?.()
    })
    await vi.waitFor(() => expect(navigatedSessions()).toEqual([{ sessionId: 'session-a' }]))
    expect(activeSessionId()).toBe('session-a')
    finishFirst()

    await vi.waitFor(() =>
      expect(navigatedSessions()).toEqual([{ sessionId: 'session-a' }, { sessionId: 'session-b' }]),
    )
    expect(activeSessionId()).toBe('session-b')
  })

  it('shows an error instead of silently losing a link whose lookup fails', async () => {
    mocks.listSessionsByIds.mockRejectedValueOnce(new Error('host unavailable'))
    mocks.requests.push('session-1')

    renderHook(useOpenSessionLinkRequests)

    await vi.waitFor(() =>
      expect(toast()).toMatchObject({
        message: 'Could not open session session-1.',
        variant: 'error',
      }),
    )
  })

  it('waits for settings before taking a link', async () => {
    usePreferencesStore.setState({ isLoaded: false })
    mocks.known.set('session-1', { id: 'session-1' })
    mocks.requests.push('session-1')

    renderHook(useOpenSessionLinkRequests)
    await Promise.resolve()
    expect(mocks.requests).toEqual(['session-1'])

    act(() => usePreferencesStore.setState({ isLoaded: true }))
    await vi.waitFor(() => expect(navigatedSessions()).toEqual([{ sessionId: 'session-1' }]))
  })
})
