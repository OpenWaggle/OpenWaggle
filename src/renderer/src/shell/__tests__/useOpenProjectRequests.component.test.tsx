import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const listener: { current: (() => void) | null } = { current: null }
  const requests: (string | null)[] = []
  return {
    listener,
    requests,
    navigate: vi.fn(async () => undefined),
    openProjectInDraft: vi.fn(async (_deps: unknown, _path: string) => undefined),
    showToast: vi.fn(),
    unsubscribe: vi.fn(),
    settingsLoaded: { current: true },
  }
})

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mocks.navigate }))
vi.mock('@/features/sidebar/hooks', () => ({
  openProjectInDraft: mocks.openProjectInDraft,
  storeProjectDraftNavigation: (navigate: unknown) => ({ navigate }),
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
    takeOpenProjectRequest: async () => mocks.requests.shift() ?? null,
    onOpenProjectRequested: (listener: () => void) => {
      mocks.listener.current = listener
      return mocks.unsubscribe
    },
  },
}))

const { useOpenProjectRequests } = await import('../useOpenProjectRequests')

const openedPaths = () => mocks.openProjectInDraft.mock.calls.map(([, path]) => path)

beforeEach(() => {
  mocks.listener.current = null
  mocks.requests.length = 0
  mocks.navigate.mockClear()
  mocks.openProjectInDraft.mockReset().mockResolvedValue(undefined)
  mocks.showToast.mockClear()
  mocks.unsubscribe.mockClear()
  mocks.settingsLoaded.current = true
})

describe('command-line project requests', () => {
  it('opens a project requested before the window loaded, like the sidebar does', async () => {
    mocks.requests.push('/work/app')

    renderHook(useOpenProjectRequests)

    await vi.waitFor(() => expect(openedPaths()).toEqual(['/work/app']))
    expect(mocks.openProjectInDraft.mock.calls[0]?.[0]).toEqual({ navigate: mocks.navigate })
  })

  it('opens projects requested while the app is running, one at a time', async () => {
    renderHook(useOpenProjectRequests)
    await vi.waitFor(() => expect(mocks.listener.current).not.toBeNull())
    let finishFirst: () => void = () => undefined
    mocks.openProjectInDraft.mockImplementationOnce(
      () => new Promise<undefined>((resolve) => (finishFirst = () => resolve(undefined))),
    )

    mocks.requests.push('/work/api', '/work/web')
    act(() => {
      mocks.listener.current?.()
      mocks.listener.current?.()
    })
    await vi.waitFor(() => expect(openedPaths()).toEqual(['/work/api']))
    finishFirst()

    await vi.waitFor(() => expect(openedPaths()).toEqual(['/work/api', '/work/web']))
  })

  it('shows an error instead of silently losing a request that fails', async () => {
    mocks.openProjectInDraft.mockRejectedValueOnce(new Error('model refresh failed'))
    mocks.requests.push('/work/app')

    renderHook(useOpenProjectRequests)

    await vi.waitFor(() =>
      expect(mocks.showToast).toHaveBeenCalledWith('Could not open /work/app.', 'error'),
    )
  })

  it('waits for settings before selecting a project', () => {
    mocks.settingsLoaded.current = false
    mocks.requests.push('/work/app')

    const { unmount } = renderHook(useOpenProjectRequests)

    expect(mocks.listener.current).toBeNull()
    expect(mocks.requests).toEqual(['/work/app'])
    unmount()
  })

  it('unsubscribes when the app shell unmounts', () => {
    const { unmount } = renderHook(useOpenProjectRequests)
    unmount()

    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1)
  })
})
