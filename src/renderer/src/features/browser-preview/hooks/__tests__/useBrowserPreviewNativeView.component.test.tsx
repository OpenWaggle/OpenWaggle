import type { BrowserPreviewState } from '@shared/types/browser-preview'
import { DEFAULT_BROWSER_PREVIEW_CONTROL_STATE } from '@shared/types/browser-preview-controls'
import { act, render, waitFor } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserPreviewMaterializedTab } from '../../browser-preview-model'
import { useBrowserPreviewNativeView } from '../useBrowserPreviewNativeView'

const api = vi.hoisted(() => ({
  onBrowserPreviewShortcut: vi.fn(() => () => undefined),
  onBrowserPreviewState: vi.fn(() => () => undefined),
  openBrowserPreview: vi.fn<() => Promise<BrowserPreviewState>>(),
  openExternal: vi.fn(async () => undefined),
  registerBrowserPreviewOwner: vi.fn<() => Promise<void>>(),
  setBrowserPreviewBounds: vi.fn(async () => undefined),
}))

vi.mock('@/shared/lib/ipc', () => ({ api }))

const TAB: BrowserPreviewMaterializedTab = {
  id: 'preview-1',
  ownerKey: 'session-1',
  kind: 'preview',
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
}

function NativeViewHarness({ tab = TAB }: { readonly tab?: BrowserPreviewMaterializedTab }) {
  const addressRef = useRef<HTMLInputElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  useBrowserPreviewNativeView({
    addressRef,
    onClose: vi.fn(),
    onError: vi.fn(),
    onState: vi.fn(),
    tab,
    viewportRef,
  })
  return <div ref={viewportRef} />
}

function nativeState(): BrowserPreviewState {
  return { ...TAB, previewId: TAB.id, error: null, controls: DEFAULT_BROWSER_PREVIEW_CONTROL_STATE }
}

describe('useBrowserPreviewNativeView', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('does not send geometry updates while native creation is pending', async () => {
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback)
      return frames.length
    })
    api.registerBrowserPreviewOwner.mockResolvedValueOnce()
    api.openBrowserPreview.mockImplementationOnce(() => new Promise(() => undefined))
    const rendered = render(<NativeViewHarness />)
    await waitFor(() => expect(api.openBrowserPreview).toHaveBeenCalledOnce())
    act(() => {
      for (const callback of frames.splice(0)) callback(0)
    })
    expect(api.setBrowserPreviewBounds).not.toHaveBeenCalled()
    rendered.unmount()
    expect(api.setBrowserPreviewBounds).not.toHaveBeenCalled()
  })

  it('does not create a native preview after its host unmounts during owner registration', async () => {
    let finishRegistration: () => void = () => undefined
    api.registerBrowserPreviewOwner.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishRegistration = resolve
        }),
    )
    const rendered = render(<NativeViewHarness />)
    await waitFor(() => expect(api.registerBrowserPreviewOwner).toHaveBeenCalledOnce())

    rendered.unmount()
    await act(async () => finishRegistration())

    expect(api.openBrowserPreview).not.toHaveBeenCalled()
    expect(api.setBrowserPreviewBounds).not.toHaveBeenCalled()
  })

  it('hides a late-created view when its presentation has already unmounted', async () => {
    let finishOpen: (state: BrowserPreviewState) => void = () => undefined
    api.registerBrowserPreviewOwner.mockResolvedValueOnce()
    api.openBrowserPreview.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOpen = resolve
        }),
    )
    const rendered = render(<NativeViewHarness />)
    await waitFor(() => expect(api.openBrowserPreview).toHaveBeenCalledOnce())
    rendered.unmount()
    await act(async () => finishOpen(nativeState()))
    expect(api.setBrowserPreviewBounds).toHaveBeenCalledExactlyOnceWith(TAB.id, null)
  })

  it.each(['default', 'incognito'])(
    'does not let an old creation response hide a replacement using profile %s',
    async (profileId) => {
      let finishOldOpen: (state: BrowserPreviewState) => void = () => undefined
      api.registerBrowserPreviewOwner.mockResolvedValue()
      api.openBrowserPreview
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              finishOldOpen = resolve
            }),
        )
        .mockImplementationOnce(() => new Promise(() => undefined))
      const original = render(<NativeViewHarness />)
      await waitFor(() => expect(api.openBrowserPreview).toHaveBeenCalledOnce())
      original.unmount()
      const replacement = render(<NativeViewHarness tab={{ ...TAB, profileId }} />)
      await waitFor(() => expect(api.openBrowserPreview).toHaveBeenCalledTimes(2))
      await act(async () => finishOldOpen(nativeState()))
      expect(api.setBrowserPreviewBounds).not.toHaveBeenCalled()
      replacement.unmount()
    },
  )
})
