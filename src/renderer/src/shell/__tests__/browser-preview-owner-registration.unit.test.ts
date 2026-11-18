import type { BrowserPreviewState } from '@shared/types/browser-preview'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  HIDDEN_BROWSER_PREVIEW_BOUNDS,
  useBrowserPreviewFloatingStore,
} from '@/features/browser-preview'
import { usePreferencesStore } from '@/features/settings/state'
import { useRightSidebarCoordinator } from '@/shared/lib/right-sidebar-coordinator'
import { beginWorkspaceOwnerHandoff } from '@/shared/lib/workspace-owner-handoff'
import { useWorkspacePanelStore } from '../workspace-panel-store'

const api = vi.hoisted(() => {
  let stateListener: ((state: BrowserPreviewState) => void) | null = null
  return {
    acknowledgeBrowserPreviewOpenRequest: vi.fn(),
    closeBrowserPreview: vi.fn(),
    emitState(state: BrowserPreviewState) {
      stateListener?.(state)
    },
    navigateBrowserPreview: vi.fn(),
    onBrowserPreviewState: vi.fn((listener: (state: BrowserPreviewState) => void) => {
      stateListener = listener
      return () => {
        if (stateListener === listener) stateListener = null
      }
    }),
    onBrowserPreviewOpenRequest: vi.fn(() => vi.fn()),
    onBrowserPreviewOpenRequestCancellation: vi.fn(() => vi.fn()),
    openBrowserPreview: vi.fn(),
    registerBrowserPreviewOwner: vi.fn(),
    unregisterBrowserPreviewOwner: vi.fn(),
  }
})
const waitForBrowserPreviewPresentation = vi.hoisted(() => vi.fn(async () => true))

vi.mock('@/shared/lib/ipc', () => ({ api }))
vi.mock('../browser-preview-presentation', () => ({ waitForBrowserPreviewPresentation }))

import {
  cancelRequestedPreview,
  ensureBrowserPreviewOwnerRegistered,
  materializeRequestedPreview,
  quiesceBrowserPreviewOwnerForHandoff,
  unregisterBrowserPreviewOwner,
} from '../browser-preview-owner-runtime'

const state: BrowserPreviewState = {
  previewId: 'agent-preview',
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

describe('browser preview owner registration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.openBrowserPreview.mockResolvedValue(state)
    api.closeBrowserPreview.mockResolvedValue(undefined)
    api.navigateBrowserPreview.mockResolvedValue(state)
    api.registerBrowserPreviewOwner.mockResolvedValue(undefined)
    api.unregisterBrowserPreviewOwner.mockResolvedValue(undefined)
    api.acknowledgeBrowserPreviewOpenRequest.mockResolvedValue(undefined)
    usePreferencesStore.setState({ settings: DEFAULT_SETTINGS })
    useBrowserPreviewFloatingStore.setState({ byOwnerKey: {} })
    useWorkspacePanelStore.setState({ groups: {} })
    useRightSidebarCoordinator.setState({ activeClaim: null })
  })

  afterEach(async () => {
    await unregisterBrowserPreviewOwner('session-1')
  })

  it('drains an admitted native open before handoff while rejecting new materializations', async () => {
    await ensureBrowserPreviewOwnerRegistered('session-1')
    const pending = Promise.withResolvers<BrowserPreviewState>()
    api.openBrowserPreview.mockReturnValueOnce(pending.promise)
    const request = {
      requestId: 'handoff-before',
      generation: 1,
      ownerKey: 'session-1',
      previewId: 'agent-preview',
      profileId: 'default',
      url: 'https://example.com/',
      visible: false,
      activate: false,
    }
    const admitted = materializeRequestedPreview(request)
    const release = beginWorkspaceOwnerHandoff('session-1', 'session-created')
    try {
      let drained = false
      const quiesce = quiesceBrowserPreviewOwnerForHandoff('session-1').then(() => {
        drained = true
      })
      await materializeRequestedPreview({
        ...request,
        requestId: 'handoff-after',
        previewId: 'blocked-preview',
      })
      expect(api.openBrowserPreview).toHaveBeenCalledTimes(1)
      expect(drained).toBe(false)
      pending.resolve(state)
      await Promise.all([admitted, quiesce])
      expect(drained).toBe(true)
      expect(
        useWorkspacePanelStore.getState().groups['session-1']?.browserTabs.map((tab) => tab.id),
      ).toEqual(['agent-preview'])
      expect(api.acknowledgeBrowserPreviewOpenRequest).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: 'handoff-after', success: false }),
      )
    } finally {
      pending.resolve(state)
      release()
    }
  })

  it('materializes the first background agent tab without opening the sidebar', async () => {
    await ensureBrowserPreviewOwnerRegistered('session-1')
    await materializeRequestedPreview({
      requestId: 'request-1',
      generation: 1,
      ownerKey: 'session-1',
      previewId: 'agent-preview',
      profileId: 'default',
      url: 'https://example.com',
      visible: false,
      activate: false,
    })

    expect(api.openBrowserPreview).toHaveBeenCalledExactlyOnceWith({
      previewId: 'agent-preview',
      ownerKey: 'session-1',
      profileId: 'default',
      url: 'https://example.com/',
      bounds: HIDDEN_BROWSER_PREVIEW_BOUNDS,
      visible: false,
      audioMuted: false,
      initialControls: {
        viewport: DEFAULT_SETTINGS.browserDefaultViewport,
        zoomFactor: DEFAULT_SETTINGS.browserDefaultZoomFactor,
        appearance: DEFAULT_SETTINGS.browserDefaultAppearance,
      },
    })
    expect(useWorkspacePanelStore.getState().groups['session-1']).toMatchObject({
      activeSurface: null,
      browserTabs: [{ id: 'agent-preview', ownerKey: 'session-1', profileId: 'default' }],
      panelOpen: false,
    })
    expect(useRightSidebarCoordinator.getState().activeClaim).toBeNull()
    expect(api.acknowledgeBrowserPreviewOpenRequest).toHaveBeenCalledWith({
      requestId: 'request-1',
      generation: 1,
      ownerKey: 'session-1',
      previewId: 'agent-preview',
      success: true,
    })
  })

  it('rolls back a canceled hidden materialization without claiming the panel', async () => {
    let resolveOpen: ((value: BrowserPreviewState) => void) | undefined
    api.openBrowserPreview.mockImplementationOnce(
      () =>
        new Promise<BrowserPreviewState>((resolve) => {
          resolveOpen = resolve
        }),
    )
    await ensureBrowserPreviewOwnerRegistered('session-1')
    const opening = materializeRequestedPreview({
      requestId: 'request-2',
      generation: 2,
      ownerKey: 'session-1',
      previewId: 'canceled-preview',
      profileId: 'default',
      url: 'https://example.com/canceled',
      visible: false,
      activate: false,
    })
    await vi.waitFor(() => expect(api.openBrowserPreview).toHaveBeenCalledOnce())

    cancelRequestedPreview({
      requestId: 'request-2',
      generation: 2,
      ownerKey: 'session-1',
      previewId: 'canceled-preview',
    })
    if (!resolveOpen) throw new Error('Expected the native open to be pending.')
    resolveOpen({ ...state, previewId: 'canceled-preview', url: 'https://example.com/canceled' })
    await opening

    expect(api.closeBrowserPreview).toHaveBeenCalledWith('canceled-preview')
    expect(
      useWorkspacePanelStore
        .getState()
        .groups['session-1']?.browserTabs.some((tab) => tab.id === 'canceled-preview'),
    ).toBe(false)
    expect(useRightSidebarCoordinator.getState().activeClaim).toBeNull()
    expect(api.acknowledgeBrowserPreviewOpenRequest).not.toHaveBeenCalled()
  })

  it('auto-shows a visible automation request as floating without replacing the right panel', async () => {
    await ensureBrowserPreviewOwnerRegistered('session-1')
    useWorkspacePanelStore.getState().showTerminal('session-1')

    await materializeRequestedPreview({
      requestId: 'request-visible',
      generation: 3,
      ownerKey: 'session-1',
      previewId: 'agent-preview',
      profileId: 'default',
      url: 'https://example.com',
      visible: true,
      activate: false,
    })

    expect(useWorkspacePanelStore.getState().groups['session-1']).toMatchObject({
      activeSurface: { kind: 'terminal' },
      panelOpen: true,
    })
    expect(useBrowserPreviewFloatingStore.getState().byOwnerKey['session-1']).toMatchObject({
      previewId: 'agent-preview',
    })
    expect(waitForBrowserPreviewPresentation).toHaveBeenCalledExactlyOnceWith('agent-preview')
    expect(waitForBrowserPreviewPresentation.mock.invocationCallOrder[0]).toBeLessThan(
      api.acknowledgeBrowserPreviewOpenRequest.mock.invocationCallOrder[0] ??
        Number.POSITIVE_INFINITY,
    )
  })

  it('synchronizes state events for retained previews that have no mounted panel', async () => {
    await ensureBrowserPreviewOwnerRegistered('session-1')
    await materializeRequestedPreview({
      requestId: 'request-background-state',
      generation: 4,
      ownerKey: 'session-1',
      previewId: 'agent-preview',
      profileId: 'default',
      url: 'https://example.com',
      visible: false,
      activate: false,
    })
    const favicon = {
      dataUrl: 'data:image/png;base64,AAAA',
      pageUrl: 'https://example.com/',
      capturedAt: 1,
    }

    api.emitState({
      ...state,
      title: 'Background title',
      audioMuted: true,
      audible: true,
      favicon,
      controller: { kind: 'agent', action: 'click', pointer: { x: 20, y: 30 } },
    })

    expect(useWorkspacePanelStore.getState().groups['session-1']?.browserTabs[0]).toMatchObject({
      title: 'Background title',
      audioMuted: true,
      audible: true,
      favicon,
      controller: { kind: 'agent', action: 'click', pointer: { x: 20, y: 30 } },
    })

    api.emitState({ ...state, profileId: 'stale-profile', title: 'Stale replacement' })
    expect(useWorkspacePanelStore.getState().groups['session-1']?.browserTabs[0]?.title).toBe(
      'Background title',
    )
  })
})
