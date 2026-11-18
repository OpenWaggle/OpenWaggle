import { DEFAULT_SETTINGS, type Settings } from '@shared/types/settings'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '@/features/chat/state'
import { useProviderStore } from '@/features/providers/state'
import { usePreferencesStore } from '@/features/settings/state'
import { useUIStore } from '@/shell/ui-store'

/*
 * Only the preload and the router's navigate are replaced: the hook opens a project through the
 * real sidebar action and stores, so each case asserts the project and draft the app ends up on.
 */
const mocks = vi.hoisted(() => {
  const listener: { current: (() => void) | null } = { current: null }
  const requests: (string | null)[] = []
  return {
    listener,
    requests,
    navigate: vi.fn(async (_options: unknown) => undefined),
    updateSettings: vi.fn(async (_patch: Partial<Settings>) => ({ ok: true })),
    unsubscribe: vi.fn(),
  }
})

// A memory router would add a route tree for one navigate call; navigation is the outcome here.
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mocks.navigate }))
vi.mock('@/shared/lib/ipc', async () => ({
  api: (await import('@/test-utils/preload-api')).preloadApi({
    takeOpenProjectRequest: async () => mocks.requests.shift() ?? null,
    onOpenProjectRequested: (listener: () => void) => {
      mocks.listener.current = listener
      return mocks.unsubscribe
    },
    updateSettings: mocks.updateSettings,
    getProjectPreferences: async () => ({}),
    getProviderModels: async () => [],
    getAuthAccountInfos: async () => [],
    getGitStatus: async () => null,
    listGitBranches: async () => [],
  }),
}))

const { useOpenProjectRequests } = await import('../useOpenProjectRequests')

const openProject = () => usePreferencesStore.getState().settings.projectPath
const draftProject = () => useChatStore.getState().draftSession?.projectPath

function resetStores() {
  usePreferencesStore.setState(
    { ...usePreferencesStore.getInitialState(), settings: DEFAULT_SETTINGS, isLoaded: true },
    true,
  )
  useProviderStore.setState(useProviderStore.getInitialState(), true)
  useChatStore.setState(useChatStore.getInitialState(), true)
  useUIStore.setState({ toastMessage: null, toastData: null })
}

beforeEach(() => {
  mocks.listener.current = null
  mocks.requests.length = 0
  mocks.navigate.mockClear()
  mocks.updateSettings.mockReset().mockResolvedValue({ ok: true })
  mocks.unsubscribe.mockClear()
  resetStores()
})
afterEach(resetStores)

describe('command-line project requests', () => {
  it('opens a project requested before the window loaded, like the sidebar does', async () => {
    mocks.requests.push('/work/app')

    renderHook(useOpenProjectRequests)

    await vi.waitFor(() => expect(openProject()).toBe('/work/app'))
    expect(draftProject()).toBe('/work/app')
    expect(usePreferencesStore.getState().settings.recentProjects).toContain('/work/app')
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/' })
  })

  it('opens projects requested while the app is running, one at a time', async () => {
    renderHook(useOpenProjectRequests)
    await vi.waitFor(() => expect(mocks.listener.current).not.toBeNull())
    const firstSave = Promise.withResolvers<{ ok: true }>()
    mocks.updateSettings.mockReturnValueOnce(firstSave.promise)

    mocks.requests.push('/work/api', '/work/web')
    act(() => {
      mocks.listener.current?.()
      mocks.listener.current?.()
    })
    await vi.waitFor(() => expect(draftProject()).toBe('/work/api'))
    // The second request waits, untaken, until the first project is open.
    expect(mocks.requests).toEqual(['/work/web'])
    await act(async () => firstSave.resolve({ ok: true }))

    await vi.waitFor(() => expect(openProject()).toBe('/work/web'))
    expect(draftProject()).toBe('/work/web')
  })

  it('shows an error instead of silently losing a request that fails', async () => {
    mocks.updateSettings.mockRejectedValueOnce(new Error('settings write failed'))
    mocks.requests.push('/work/app')

    renderHook(useOpenProjectRequests)

    await vi.waitFor(() =>
      expect(useUIStore.getState().toastData).toMatchObject({
        message: 'Could not open /work/app.',
        variant: 'error',
      }),
    )
  })

  it('waits for settings before selecting a project', () => {
    usePreferencesStore.setState({ isLoaded: false })
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
