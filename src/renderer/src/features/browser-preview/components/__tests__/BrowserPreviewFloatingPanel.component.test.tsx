import type { BrowserPreviewState } from '@shared/types/browser-preview'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { usePreferencesStore } from '@/features/settings/state'
import type { BrowserPreviewMaterializedTab } from '../../browser-preview-model'
import { pageHasOccludingDialog } from '../../lib/browser-preview-native-bounds'
import { useBrowserPreviewFloatingStore } from '../../state/browser-preview-floating-store'
import { BrowserPreviewFloatingPanel } from '../BrowserPreviewFloatingPanel'

const api = vi.hoisted(() => ({
  closeBrowserPreviewPictureInPicture: vi.fn(),
  openBrowserPreviewPictureInPicture: vi.fn(),
  openExternal: vi.fn(),
  reloadBrowserPreview: vi.fn(),
  setBrowserPreviewBounds: vi.fn(async () => undefined),
}))

vi.mock('@/shared/lib/ipc', () => ({ api }))
vi.mock('../../hooks/useBrowserPreviewNativeView', () => ({
  useBrowserPreviewNativeView: vi.fn(() => true),
}))

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
  controller: { kind: 'agent', action: 'click', pointer: { x: 24, y: 42 } },
}

function previewState(pictureInPicture: boolean): BrowserPreviewState {
  return {
    previewId: TAB.id,
    ownerKey: TAB.ownerKey,
    profileId: TAB.profileId,
    url: TAB.url,
    title: TAB.title,
    loading: false,
    canGoBack: false,
    canGoForward: false,
    error: null,
    audioMuted: false,
    audible: false,
    favicon: null,
    controller: TAB.controller,
    controls: {
      zoomFactor: 1,
      appearance: 'system',
      viewport: { mode: 'fill' },
      pictureInPicture,
      picking: false,
      recording: false,
    },
  }
}

function renderFloating() {
  const callbacks = {
    onCloseBrowser: vi.fn(),
    onError: vi.fn(),
    onOpenInPanel: vi.fn(),
    onUpdate: vi.fn(),
  }
  render(<BrowserPreviewFloatingPanel tab={TAB} {...callbacks} />)
  return callbacks
}

describe('BrowserPreviewFloatingPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    usePreferencesStore.setState({ settings: DEFAULT_SETTINGS })
    useBrowserPreviewFloatingStore.setState({ byOwnerKey: {} })
    useBrowserPreviewFloatingStore.getState().open(TAB.ownerKey, TAB.id)
    api.openBrowserPreviewPictureInPicture.mockResolvedValue(previewState(true))
    api.closeBrowserPreviewPictureInPicture.mockResolvedValue(previewState(false))
    api.reloadBrowserPreview.mockResolvedValue(previewState(false))
  })

  it('shows agent ownership and keeps the page controls outside the native guest bounds', () => {
    renderFloating()

    expect(screen.getByText('Agent controlling browser')).toBeInTheDocument()
    expect(screen.getByLabelText('Floating browser preview')).toHaveAttribute(
      'data-browser-preview-floating',
      TAB.id,
    )
    expect(screen.getByLabelText('Open preview in right panel')).toBeInTheDocument()
    expect(screen.getByLabelText('Resize floating preview')).toBeInTheDocument()
    expect(document.querySelectorAll('[data-floating-resize-handle]')).toHaveLength(8)
  })

  it('suspends DOM and native observers together, then restores without closing its tab', async () => {
    const callbacks = {
      onCloseBrowser: vi.fn(),
      onError: vi.fn(),
      onOpenInPanel: vi.fn(),
      onUpdate: vi.fn(),
    }
    const view = render(<BrowserPreviewFloatingPanel tab={TAB} suspended {...callbacks} />)
    const panel = screen.getByLabelText('Floating browser preview')
    expect(panel).toHaveStyle({ visibility: 'hidden' })
    expect(panel).toHaveAttribute('inert')
    expect(pageHasOccludingDialog(TAB.ownerKey)).toBe(true)
    expect(pageHasOccludingDialog('other-session')).toBe(false)
    await waitFor(() => expect(api.setBrowserPreviewBounds).toHaveBeenLastCalledWith(TAB.id, null))

    view.rerender(<BrowserPreviewFloatingPanel tab={TAB} suspended={false} {...callbacks} />)
    expect(panel).not.toHaveAttribute('inert')
    expect(pageHasOccludingDialog(TAB.ownerKey)).toBe(false)
    expect(callbacks.onCloseBrowser).not.toHaveBeenCalled()
    expect(useBrowserPreviewFloatingStore.getState().byOwnerKey[TAB.ownerKey]?.previewId).toBe(
      TAB.id,
    )
  })

  it('supports arrow-key resizing without changing the source viewport', () => {
    useBrowserPreviewFloatingStore.getState().open(TAB.ownerKey, 'other')
    useBrowserPreviewFloatingStore
      .getState()
      .open(TAB.ownerKey, TAB.id, { width: 1280, height: 800 })
    renderFloating()
    fireEvent.keyDown(
      screen.getByLabelText('Resize floating preview from left edge. Use arrow keys to resize.'),
      { key: 'ArrowLeft' },
    )
    const state = useBrowserPreviewFloatingStore.getState().byOwnerKey[TAB.ownerKey]
    expect(state?.size?.width).toBe(330)
    expect(state?.sourceViewport).toEqual({ width: 1280, height: 800 })
  })

  it('focuses a pointer-activated resize handle for subsequent keyboard resizing', () => {
    renderFloating()
    const handle = screen.getByLabelText(
      'Resize floating preview from left edge. Use arrow keys to resize.',
    )
    Object.defineProperties(handle, {
      setPointerCapture: { value: vi.fn() },
      hasPointerCapture: { value: vi.fn(() => true) },
      releasePointerCapture: { value: vi.fn() },
    })
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1 })
    fireEvent.pointerUp(handle, { button: 0, pointerId: 1 })
    expect(handle).toHaveFocus()
    fireEvent.keyDown(handle, { key: 'ArrowLeft', shiftKey: true })
    expect(useBrowserPreviewFloatingStore.getState().byOwnerKey[TAB.ownerKey]?.size?.width).toBe(
      370,
    )
  })

  it('returns to the right panel and closes only the floating placement', () => {
    const callbacks = renderFloating()

    fireEvent.click(screen.getByLabelText('Open preview in right panel'))

    expect(callbacks.onOpenInPanel).toHaveBeenCalledOnce()
    expect(useBrowserPreviewFloatingStore.getState().byOwnerKey[TAB.ownerKey]).toBeUndefined()
    expect(callbacks.onCloseBrowser).not.toHaveBeenCalled()
  })

  it('closes the mini player without destroying its browser tab', () => {
    const callbacks = renderFloating()

    fireEvent.click(screen.getByLabelText('Close floating preview'))

    expect(useBrowserPreviewFloatingStore.getState().byOwnerKey[TAB.ownerKey]).toBeUndefined()
    expect(callbacks.onCloseBrowser).not.toHaveBeenCalled()
  })

  it('opens native detached picture-in-picture and applies the returned state', async () => {
    const callbacks = renderFloating()

    fireEvent.click(screen.getByLabelText('Pop preview into separate window'))

    await waitFor(() =>
      expect(api.openBrowserPreviewPictureInPicture).toHaveBeenCalledExactlyOnceWith(TAB.id),
    )
    expect(callbacks.onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ controller: TAB.controller, url: TAB.url }),
    )
  })

  it('rejects a direct control response for another owner or storage profile', async () => {
    api.openBrowserPreviewPictureInPicture.mockResolvedValueOnce({
      ...previewState(true),
      ownerKey: 'session-other',
      profileId: 'work',
    })
    const callbacks = renderFloating()

    fireEvent.click(screen.getByLabelText('Pop preview into separate window'))

    await waitFor(() =>
      expect(api.openBrowserPreviewPictureInPicture).toHaveBeenCalledExactlyOnceWith(TAB.id),
    )
    expect(callbacks.onUpdate).not.toHaveBeenCalled()
  })

  it('moves native guest geometry with the floating renderer placement', async () => {
    let x = 40
    const bounds = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(() => ({
        x,
        y: 60,
        width: 300,
        height: 170,
        top: 60,
        right: x + 300,
        bottom: 230,
        left: x,
        toJSON: () => ({}),
      }))
    renderFloating()
    await waitFor(() =>
      expect(api.setBrowserPreviewBounds).toHaveBeenCalledWith(TAB.id, {
        x: 40,
        y: 60,
        width: 300,
        height: 170,
      }),
    )
    api.setBrowserPreviewBounds.mockClear()

    x = 96
    act(() => {
      useBrowserPreviewFloatingStore.getState().move(TAB.ownerKey, TAB.id, { x: 96, y: 60 })
    })

    await waitFor(() =>
      expect(api.setBrowserPreviewBounds).toHaveBeenCalledWith(TAB.id, {
        x: 96,
        y: 60,
        width: 300,
        height: 170,
      }),
    )
    bounds.mockRestore()
  })
})
