import type { BrowserPreviewState } from '@shared/types/browser-preview'
import type { BrowserPreviewOpenRequest } from '@shared/types/browser-preview-owner'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
    api.unregisterBrowserPreviewOwner.mockResolvedValue(undefined)
    api.acknowledgeBrowserPreviewOpenRequest.mockResolvedValue(undefined)
    api.openBrowserPreview.mockResolvedValue(previewState)
    usePreferencesStore.setState({ settings: DEFAULT_SETTINGS })
    useWorkspacePanelStore.setState({ groups: {} })
  })

  afterEach(async () => {
    await unregisterBrowserPreviewOwner('session-1')
    await unregisterBrowserPreviewOwner('session-2')
  })

  it('keeps prior Sessions registered and materializes their first hidden tab in the background', async () => {
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
    unmount()
    expect(api.unregisterBrowserPreviewOwner).not.toHaveBeenCalled()
  })
})
