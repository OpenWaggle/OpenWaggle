import { SessionId } from '@shared/types/brand'
import type { BrowserPreviewState } from '@shared/types/browser-preview'
import type { BrowserPreviewOpenRequest } from '@shared/types/browser-preview-owner'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useBackgroundRunStore } from '@/features/chat/state'
import { usePreferencesStore } from '@/features/settings/state'
import { useWorkspacePanelStore } from '../workspace-panel-store'

const listeners = vi.hoisted(
  (): { open: ((request: BrowserPreviewOpenRequest) => void) | null } => ({
    open: null,
  }),
)

const api = vi.hoisted(() => ({
  acknowledgeBrowserPreviewOpenRequest: vi.fn(),
  closeBrowserPreview: vi.fn(),
  navigateBrowserPreview: vi.fn(),
  onBrowserPreviewState: vi.fn(() => vi.fn()),
  onBrowserPreviewOpenRequest: vi.fn((callback: (request: BrowserPreviewOpenRequest) => void) => {
    listeners.open = callback
    return vi.fn()
  }),
  onBrowserPreviewOpenRequestCancellation: vi.fn(() => vi.fn()),
  openBrowserPreview: vi.fn(),
  registerBrowserPreviewOwner: vi.fn(),
  setCurrentBrowserPreview: vi.fn(),
  unregisterBrowserPreviewOwner: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({ api }))

import { unregisterBrowserPreviewOwner } from '../browser-preview-owner-runtime'
import { useBrowserPreviewOwnerRegistration } from '../useBrowserPreviewOwnerRegistration'

const previewState: BrowserPreviewState = {
  previewId: 'background-preview',
  ownerKey: 'session-1',
  profileId: 'default',
  url: 'https://example.com/',
  title: 'Example',
  loading: false,
  canGoBack: false,
  canGoForward: false,
  error: null,
  audioMuted: false,
  audible: false,
  favicon: null,
  controller: { kind: 'human' },
  controls: {
    zoomFactor: 1,
    appearance: 'system',
    viewport: { mode: 'fill' },
    pictureInPicture: false,
    picking: false,
    recording: false,
  },
}

describe('useBrowserPreviewOwnerRegistration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listeners.open = null
    api.registerBrowserPreviewOwner.mockResolvedValue(undefined)
    api.setCurrentBrowserPreview.mockResolvedValue(undefined)
    api.unregisterBrowserPreviewOwner.mockResolvedValue(undefined)
    api.acknowledgeBrowserPreviewOpenRequest.mockResolvedValue(undefined)
    api.openBrowserPreview.mockResolvedValue(previewState)
    usePreferencesStore.setState({ settings: DEFAULT_SETTINGS })
    useWorkspacePanelStore.setState({ groups: {} })
    useBackgroundRunStore.setState({ activeRunIds: new Set() })
  })

  afterEach(async () => {
    await unregisterBrowserPreviewOwner('session-1')
    await unregisterBrowserPreviewOwner('session-2')
  })

  it('keeps prior Sessions registered and materializes their first hidden tab in the background', async () => {
    useBackgroundRunStore.getState().addActiveRun(SessionId('session-1'))
    const { rerender, unmount } = renderHook(
      ({ ownerKey }: { ownerKey: string }) => useBrowserPreviewOwnerRegistration(ownerKey),
      { initialProps: { ownerKey: 'session-1' } },
    )
    await waitFor(() => expect(api.registerBrowserPreviewOwner).toHaveBeenCalledWith('session-1'))

    rerender({ ownerKey: 'session-2' })
    await waitFor(() => expect(api.registerBrowserPreviewOwner).toHaveBeenCalledWith('session-2'))
    const open = listeners.open
    if (!open) throw new Error('Expected the global preview-open listener.')
    open({
      requestId: 'background-request',
      generation: 1,
      ownerKey: 'session-1',
      previewId: 'background-preview',
      profileId: 'default',
      url: 'https://example.com',
      visible: false,
      activate: false,
    })

    await waitFor(() => expect(api.openBrowserPreview).toHaveBeenCalledOnce())
    expect(useWorkspacePanelStore.getState().groups['session-1']).toMatchObject({
      activeSurface: null,
      panelOpen: false,
      browserTabs: [{ id: 'background-preview' }],
    })
    useBackgroundRunStore.getState().removeActiveRun(SessionId('session-1'))
    unmount()
    await waitFor(() => expect(api.unregisterBrowserPreviewOwner).toHaveBeenCalledWith('session-2'))
    expect(api.unregisterBrowserPreviewOwner).not.toHaveBeenCalledWith('session-1')
  })

  it('can visit more than 64 idle Sessions without exhausting native owner registrations', async () => {
    const registered = new Set<string>()
    api.registerBrowserPreviewOwner.mockImplementation(async (ownerKey: string) => {
      if (registered.size >= 64) throw new Error('Too many browser-preview owners are registered.')
      registered.add(ownerKey)
    })
    api.unregisterBrowserPreviewOwner.mockImplementation(async (ownerKey: string) => {
      registered.delete(ownerKey)
    })
    const { rerender, unmount } = renderHook(
      ({ ownerKey }: { ownerKey: string }) => useBrowserPreviewOwnerRegistration(ownerKey),
      { initialProps: { ownerKey: 'visited-0' } },
    )
    for (let index = 0; index < 70; index += 1) {
      const ownerKey = `visited-${index}`
      rerender({ ownerKey })
      await waitFor(() => expect(registered.has(ownerKey)).toBe(true))
    }
    expect(registered.size).toBe(1)
    unmount()
    await waitFor(() => expect(registered.size).toBe(0))
  })

  it('registers a revisited owner only after its pending unregister finishes', async () => {
    let finishUnregister: (() => void) | undefined
    const unregister = new Promise<void>((resolve) => {
      finishUnregister = resolve
    })
    api.unregisterBrowserPreviewOwner.mockImplementation((ownerKey: string) =>
      ownerKey === 'session-1' ? unregister : Promise.resolve(),
    )
    const { rerender, unmount } = renderHook(
      ({ ownerKey }: { ownerKey: string }) => useBrowserPreviewOwnerRegistration(ownerKey),
      { initialProps: { ownerKey: 'session-1' } },
    )
    await waitFor(() => expect(api.registerBrowserPreviewOwner).toHaveBeenCalledWith('session-1'))
    rerender({ ownerKey: 'session-2' })
    await waitFor(() => expect(api.unregisterBrowserPreviewOwner).toHaveBeenCalledWith('session-1'))
    rerender({ ownerKey: 'session-1' })
    expect(
      api.registerBrowserPreviewOwner.mock.calls.filter(([key]) => key === 'session-1'),
    ).toHaveLength(1)
    await act(async () => {
      finishUnregister?.()
      await unregister
    })
    await waitFor(() =>
      expect(
        api.registerBrowserPreviewOwner.mock.calls.filter(([key]) => key === 'session-1'),
      ).toHaveLength(2),
    )
    unmount()
  })

  it('keeps the next owner unavailable until navigation cleanup and registration settle', async () => {
    const registered = new Set<string>()
    let finishUnregister: (() => void) | undefined
    const pendingUnregister = new Promise<void>((resolve) => {
      finishUnregister = resolve
    })
    api.registerBrowserPreviewOwner.mockImplementation(async (ownerKey: string) => {
      registered.add(ownerKey)
    })
    api.unregisterBrowserPreviewOwner.mockImplementation(async (ownerKey: string) => {
      if (ownerKey === 'session-1') await pendingUnregister
      registered.delete(ownerKey)
    })
    api.setCurrentBrowserPreview.mockImplementation(async (ownerKey: string) => {
      if (!registered.has(ownerKey)) {
        throw new Error('Browser-preview owner is not registered to this renderer.')
      }
    })
    const { rerender, unmount } = renderHook(
      ({ ownerKey }: { ownerKey: string }) => useBrowserPreviewOwnerRegistration(ownerKey),
      { initialProps: { ownerKey: 'session-1' } },
    )
    try {
      await waitFor(() =>
        expect(api.setCurrentBrowserPreview).toHaveBeenCalledWith('session-1', null),
      )
      rerender({ ownerKey: 'session-2' })
      await waitFor(() =>
        expect(api.unregisterBrowserPreviewOwner).toHaveBeenCalledWith('session-1'),
      )
      expect(api.registerBrowserPreviewOwner).not.toHaveBeenCalledWith('session-2')
      await expect(api.setCurrentBrowserPreview('session-2', null)).rejects.toThrow(
        'Browser-preview owner is not registered to this renderer.',
      )
      await act(async () => {
        finishUnregister?.()
        await pendingUnregister
      })
      await waitFor(() => expect(registered).toEqual(new Set(['session-2'])))
      await expect(api.setCurrentBrowserPreview('session-2', null)).resolves.toBeUndefined()
    } finally {
      finishUnregister?.()
      unmount()
      await waitFor(() => expect(registered.size).toBe(0))
    }
  })

  it('releases completed background runs before registering the next Session', async () => {
    useBackgroundRunStore.getState().addActiveRun(SessionId('session-1'))
    const { rerender, unmount } = renderHook(
      ({ ownerKey }: { ownerKey: string }) => useBrowserPreviewOwnerRegistration(ownerKey),
      { initialProps: { ownerKey: 'session-1' } },
    )
    await waitFor(() => expect(api.registerBrowserPreviewOwner).toHaveBeenCalledWith('session-1'))
    rerender({ ownerKey: 'session-2' })
    await waitFor(() => expect(api.registerBrowserPreviewOwner).toHaveBeenCalledWith('session-2'))
    expect(api.unregisterBrowserPreviewOwner).not.toHaveBeenCalledWith('session-1')
    useBackgroundRunStore.getState().removeActiveRun(SessionId('session-1'))
    rerender({ ownerKey: 'session-3' })
    await waitFor(() => expect(api.registerBrowserPreviewOwner).toHaveBeenCalledWith('session-3'))
    expect(api.unregisterBrowserPreviewOwner).toHaveBeenCalledWith('session-1')
    unmount()
    await waitFor(() => expect(api.unregisterBrowserPreviewOwner).toHaveBeenCalledWith('session-3'))
  })

  it('publishes current-tab intent only after registration completes', async () => {
    let finishRegistration: (() => void) | undefined
    const registration = new Promise<void>((resolve) => {
      finishRegistration = resolve
    })
    api.registerBrowserPreviewOwner.mockReturnValueOnce(registration)
    const { unmount } = renderHook(() =>
      useBrowserPreviewOwnerRegistration('session-1', 'selected-tab'),
    )
    await waitFor(() => expect(api.registerBrowserPreviewOwner).toHaveBeenCalledWith('session-1'))
    expect(api.setCurrentBrowserPreview).not.toHaveBeenCalled()
    await act(async () => {
      finishRegistration?.()
      await registration
    })
    await waitFor(() =>
      expect(api.setCurrentBrowserPreview).toHaveBeenCalledWith('session-1', 'selected-tab'),
    )
    unmount()
  })
})
