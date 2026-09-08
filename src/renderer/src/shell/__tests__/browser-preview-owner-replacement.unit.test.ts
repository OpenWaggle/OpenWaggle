import type { BrowserPreviewState } from '@shared/types/browser-preview'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  HIDDEN_BROWSER_PREVIEW_BOUNDS,
  useBrowserPreviewFloatingStore,
} from '@/features/browser-preview'
import { usePreferencesStore } from '@/features/settings/state'
import { useRightSidebarCoordinator } from '@/shared/lib/right-sidebar-coordinator'
import { createBrowserPreviewTab } from '../workspace-panel-model'
import { useWorkspacePanelStore } from '../workspace-panel-store'

const api = vi.hoisted(() => ({
  acknowledgeBrowserPreviewOpenRequest: vi.fn(),
  closeBrowserPreview: vi.fn(),
  navigateBrowserPreview: vi.fn(),
  onBrowserPreviewState: vi.fn(() => vi.fn()),
  onBrowserPreviewOpenRequest: vi.fn(() => vi.fn()),
  onBrowserPreviewOpenRequestCancellation: vi.fn(() => vi.fn()),
  openBrowserPreview: vi.fn(),
  registerBrowserPreviewOwner: vi.fn(),
  replaceBrowserPreviewForCapacity: vi.fn(),
  unregisterBrowserPreviewOwner: vi.fn(),
}))
const waitForBrowserPreviewPresentation = vi.hoisted(() => vi.fn(async () => true))

vi.mock('@/shared/lib/ipc', () => ({ api }))
vi.mock('../browser-preview-presentation', () => ({ waitForBrowserPreviewPresentation }))

import {
  ensureBrowserPreviewOwnerRegistered,
  materializeRequestedPreview,
  unregisterBrowserPreviewOwner,
} from '../browser-preview-owner-runtime'

const OWNER_KEY = 'replacement-session'

function nativeState(previewId: string, url: string): BrowserPreviewState {
  return {
    previewId,
    ownerKey: OWNER_KEY,
    profileId: 'default',
    url,
    title: previewId,
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
}

function populateCapacity(options?: {
  readonly activePreviewId?: string
  readonly floatingPreviewId?: string
}) {
  const browserTabs = Array.from({ length: 8 }, (_, index) =>
    createBrowserPreviewTab(
      OWNER_KEY,
      `https://example.com/${String(index)}`,
      'default',
      `old-${String(index)}`,
    ),
  )
  useWorkspacePanelStore.setState({
    groups: {
      [OWNER_KEY]: {
        browserTabs,
        activeSurface: options?.activePreviewId
          ? { kind: 'browser', previewId: options.activePreviewId }
          : { kind: 'terminal' },
        maximized: false,
        panelOpen: true,
      },
    },
  })
  if (options?.floatingPreviewId) {
    useBrowserPreviewFloatingStore.getState().open(OWNER_KEY, options.floatingPreviewId)
  }
  return browserTabs
}

describe('browser preview owner capacity replacement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.registerBrowserPreviewOwner.mockResolvedValue(undefined)
    api.unregisterBrowserPreviewOwner.mockResolvedValue(undefined)
    api.acknowledgeBrowserPreviewOpenRequest.mockResolvedValue(undefined)
    usePreferencesStore.setState({ settings: DEFAULT_SETTINGS })
    useBrowserPreviewFloatingStore.setState({ byOwnerKey: {} })
    useWorkspacePanelStore.setState({ groups: {} })
    useRightSidebarCoordinator.setState({ activeClaim: null })
  })

  afterEach(async () => {
    await unregisterBrowserPreviewOwner(OWNER_KEY)
  })

  it('replaces the oldest non-visible victim before opening the ninth automation tab', async () => {
    populateCapacity({ activePreviewId: 'old-0', floatingPreviewId: 'old-1' })
    const replacement = nativeState('new-preview', 'https://openwaggle.dev/')
    const victim = nativeState('old-2', 'https://example.com/2')
    api.replaceBrowserPreviewForCapacity.mockResolvedValueOnce({
      state: replacement,
      replacedState: victim,
    })
    await ensureBrowserPreviewOwnerRegistered(OWNER_KEY)

    await materializeRequestedPreview({
      requestId: 'capacity-request',
      generation: 1,
      ownerKey: OWNER_KEY,
      previewId: 'new-preview',
      profileId: 'default',
      url: 'https://openwaggle.dev',
      visible: false,
      activate: false,
    })

    expect(api.replaceBrowserPreviewForCapacity).toHaveBeenCalledExactlyOnceWith(
      {
        previewId: 'new-preview',
        ownerKey: OWNER_KEY,
        profileId: 'default',
        url: 'https://openwaggle.dev/',
        bounds: HIDDEN_BROWSER_PREVIEW_BOUNDS,
        visible: false,
        audioMuted: false,
        initialControls: {
          viewport: DEFAULT_SETTINGS.browserDefaultViewport,
          zoomFactor: DEFAULT_SETTINGS.browserDefaultZoomFactor,
          appearance: DEFAULT_SETTINGS.browserDefaultAppearance,
        },
      },
      'old-2',
    )
    expect(api.openBrowserPreview).not.toHaveBeenCalled()
    expect(api.closeBrowserPreview).not.toHaveBeenCalled()
    expect(
      useWorkspacePanelStore.getState().groups[OWNER_KEY]?.browserTabs.map((tab) => tab.id),
    ).toEqual(['old-0', 'old-1', 'old-3', 'old-4', 'old-5', 'old-6', 'old-7', 'new-preview'])
    expect(useWorkspacePanelStore.getState().groups[OWNER_KEY]?.activeSurface).toEqual({
      kind: 'browser',
      previewId: 'old-0',
    })
    expect(useBrowserPreviewFloatingStore.getState().byOwnerKey[OWNER_KEY]?.previewId).toBe('old-1')
    expect(api.acknowledgeBrowserPreviewOpenRequest).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'capacity-request', success: true }),
    )
  })

  it('atomically restores native and renderer state when acknowledgment fails', async () => {
    const previousTabs = populateCapacity()
    const replacement = nativeState('new-preview', 'https://openwaggle.dev/')
    const victim: BrowserPreviewState = {
      ...nativeState('old-0', 'https://example.com/0'),
      audioMuted: true,
      controls: {
        ...nativeState('old-0', 'https://example.com/0').controls,
        viewport: { mode: 'fixed', width: 390, height: 844, presetId: null },
        zoomFactor: 1.25,
        appearance: 'dark',
      },
    }
    api.replaceBrowserPreviewForCapacity
      .mockResolvedValueOnce({ state: replacement, replacedState: victim })
      .mockResolvedValueOnce({ state: victim, replacedState: replacement })
    api.acknowledgeBrowserPreviewOpenRequest.mockRejectedValueOnce(new Error('ack failed'))
    await ensureBrowserPreviewOwnerRegistered(OWNER_KEY)

    await materializeRequestedPreview({
      requestId: 'rollback-request',
      generation: 2,
      ownerKey: OWNER_KEY,
      previewId: 'new-preview',
      profileId: 'default',
      url: 'https://openwaggle.dev',
      visible: false,
      activate: false,
    })

    expect(api.replaceBrowserPreviewForCapacity).toHaveBeenNthCalledWith(
      2,
      {
        previewId: 'old-0',
        ownerKey: OWNER_KEY,
        profileId: 'default',
        url: 'https://example.com/0',
        bounds: HIDDEN_BROWSER_PREVIEW_BOUNDS,
        visible: false,
        audioMuted: true,
        initialControls: {
          viewport: { mode: 'fixed', width: 390, height: 844, presetId: null },
          zoomFactor: 1.25,
          appearance: 'dark',
        },
      },
      'new-preview',
    )
    expect(useWorkspacePanelStore.getState().groups[OWNER_KEY]?.browserTabs).toEqual(previousTabs)
    expect(api.acknowledgeBrowserPreviewOpenRequest).toHaveBeenLastCalledWith(
      expect.objectContaining({ requestId: 'rollback-request', success: false }),
    )
  })
})
