import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const listener: { current: (() => void) | null } = { current: null }
  const requests: (string | null)[] = []
  return {
    listener,
    requests,
    known: new Map<string, { id: string; archived?: boolean }>(),
    listSessionsByIds: vi.fn(),
    navigate: vi.fn(async (_options: unknown) => undefined),
    setActiveSession: vi.fn(),
    showToast: vi.fn(),
    unsubscribe: vi.fn(),
    settingsLoaded: { current: true },
  }
})

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mocks.navigate }))
vi.mock('@/features/chat/state', () => ({
  useChatStore: { getState: () => ({ setActiveSession: mocks.setActiveSession }) },
}))
vi.mock('@/features/settings/state', () => ({
  usePreferencesStore: (select: (state: { isLoaded: boolean }) => boolean) =>
    select({ isLoaded: mocks.settingsLoaded.current }),
}))
vi.mock('@/shell/ui-store', () => ({
  useUIStore: { getState: () => ({ showToast: mocks.showToast }) },
}))
vi.mock('@/shared/lib/ipc', () => ({
  api: {
    listSessionsByIds: mocks.listSessionsByIds,
    takeOpenSessionLinkRequest: async () => mocks.requests.shift() ?? null,
    onOpenSessionLinkRequested: (listener: () => void) => {
      mocks.listener.current = listener
      return mocks.unsubscribe
    },
  },
}))

const { useOpenSessionLinkRequests } = await import('../useOpenSessionLinkRequests')

const navigatedSessions = () =>
  mocks.navigate.mock.calls.map(([options]) =>
    typeof options === 'object' && options !== null && 'params' in options ? options.params : null,
  )

beforeEach(() => {
  mocks.listener.current = null
  mocks.requests.length = 0
  mocks.known.clear()
  mocks.listSessionsByIds.mockReset().mockImplementation(async (ids: readonly string[]) =>
    ids.flatMap((id) => {
      const session = mocks.known.get(id)
      return session ? [session] : []
    }),
  )
  mocks.navigate.mockClear()
  mocks.setActiveSession.mockClear()
  mocks.showToast.mockClear()
  mocks.unsubscribe.mockClear()
  mocks.settingsLoaded.current = true
})

describe('Session link requests', () => {
  it('opens a Session linked before the window loaded', async () => {
    mocks.known.set('session-1', { id: 'session-1' })
    mocks.requests.push('session-1')

    renderHook(useOpenSessionLinkRequests)

    await vi.waitFor(() => expect(navigatedSessions()).toEqual([{ sessionId: 'session-1' }]))
    expect(mocks.setActiveSession).toHaveBeenCalledWith('session-1')
    expect(mocks.showToast).not.toHaveBeenCalled()
  })

  it('opens an archived Session without restoring it', async () => {
    mocks.known.set('session-archived', { id: 'session-archived', archived: true })
    mocks.requests.push('session-archived')

    renderHook(useOpenSessionLinkRequests)

    await vi.waitFor(() => expect(navigatedSessions()).toEqual([{ sessionId: 'session-archived' }]))
    expect(mocks.setActiveSession).toHaveBeenCalledWith('session-archived')
    expect(mocks.showToast).not.toHaveBeenCalled()
  })

  it('reports an unknown Session and stays on the current page', async () => {
    mocks.requests.push('session-missing')

    renderHook(useOpenSessionLinkRequests)

    await vi.waitFor(() =>
      expect(mocks.showToast).toHaveBeenCalledWith('Session not found: session-missing', 'error'),
    )
    expect(mocks.navigate).not.toHaveBeenCalled()
    expect(mocks.setActiveSession).not.toHaveBeenCalled()
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
    finishFirst()

    await vi.waitFor(() =>
      expect(navigatedSessions()).toEqual([{ sessionId: 'session-a' }, { sessionId: 'session-b' }]),
    )
  })

  it('shows an error instead of silently losing a link whose lookup fails', async () => {
    mocks.listSessionsByIds.mockRejectedValueOnce(new Error('host unavailable'))
    mocks.requests.push('session-1')

    renderHook(useOpenSessionLinkRequests)

    await vi.waitFor(() =>
      expect(mocks.showToast).toHaveBeenCalledWith('Could not open session session-1.', 'error'),
    )
  })

  it('waits for settings before taking a link', async () => {
    mocks.settingsLoaded.current = false
    mocks.known.set('session-1', { id: 'session-1' })
    mocks.requests.push('session-1')

    const { rerender } = renderHook(useOpenSessionLinkRequests)
    await Promise.resolve()
    expect(mocks.requests).toEqual(['session-1'])

    mocks.settingsLoaded.current = true
    rerender()
    await vi.waitFor(() => expect(navigatedSessions()).toEqual([{ sessionId: 'session-1' }]))
  })
})
