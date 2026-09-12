import type {
  BrowserPreviewShortcutEvent,
  BrowserPreviewState,
} from '@shared/types/browser-preview'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserPreviewTab } from '../../browser-preview-model'
import {
  clearBrowserPreviewExternalFallback,
  registerBrowserPreviewExternalFallback,
} from '../../lib/browser-preview-external-fallback'
import { useBrowserPreviewFloatingStore } from '../../state/browser-preview-floating-store'
import { BrowserPreviewPanel } from '../BrowserPreviewPanel'

const mocks = vi.hoisted(() => {
  let stateListener: ((state: BrowserPreviewState) => void) | null = null
  let shortcutListener: ((event: BrowserPreviewShortcutEvent) => void) | null = null
  const state = (url = 'https://example.com/'): BrowserPreviewState => ({
    previewId: 'preview-1',
    ownerKey: 'session-1',
    profileId: 'default',
    url,
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
  })
  return {
    state,
    emitState(next: BrowserPreviewState) {
      stateListener?.(next)
    },
    emitShortcut(event: BrowserPreviewShortcutEvent) {
      shortcutListener?.(event)
    },
    openBrowserPreview: vi.fn(async () => state()),
    setBrowserPreviewBounds: vi.fn(async () => undefined),
    navigateBrowserPreview: vi.fn(async (_previewId: string, url: string) => state(url)),
    goBackBrowserPreview: vi.fn(async () => state()),
    goForwardBrowserPreview: vi.fn(async () => state()),
    reloadBrowserPreview: vi.fn(async () => state()),
    stopBrowserPreview: vi.fn(async () => state()),
    closeBrowserPreview: vi.fn(async (_previewId: string) => undefined),
    registerBrowserPreviewOwner: vi.fn(async () => undefined),
    openExternal: vi.fn(async () => undefined),
    onBrowserPreviewState: vi.fn((listener: (state: BrowserPreviewState) => void) => {
      stateListener = listener
      return () => {
        if (stateListener === listener) stateListener = null
      }
    }),
    onBrowserPreviewShortcut: vi.fn((listener: (event: BrowserPreviewShortcutEvent) => void) => {
      shortcutListener = listener
      return () => {
        if (shortcutListener === listener) shortcutListener = null
      }
    }),
    onBrowserPreviewRecordingRequest: vi.fn(() => () => undefined),
    onBrowserPreviewRecordingCancel: vi.fn(() => () => undefined),
  }
})

vi.mock('@/shared/lib/ipc', () => ({ api: mocks }))

const INITIAL_TAB: BrowserPreviewTab = {
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

const callbacks = {
  onError: vi.fn(),
  onFloat: vi.fn(),
  onMaterialize: vi.fn(),
  onUpdate: vi.fn(),
}

function PreviewHarness() {
  const [tab, setTab] = useState<BrowserPreviewTab | null>(INITIAL_TAB)
  if (tab === null) return null
  return (
    <BrowserPreviewPanel
      tab={tab}
      onClose={() => {
        void mocks.closeBrowserPreview(tab.id)
        setTab(null)
      }}
      onError={callbacks.onError}
      onFloat={callbacks.onFloat}
      onMaterialize={callbacks.onMaterialize}
      onUpdate={(patch) => {
        callbacks.onUpdate(patch)
        setTab((current) => (current === null ? null : { ...current, ...patch }))
      }}
    />
  )
}

describe('BrowserPreviewPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useBrowserPreviewFloatingStore.setState({ byOwnerKey: {} })
    clearBrowserPreviewExternalFallback(INITIAL_TAB.id)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 320,
      y: 80,
      width: 640,
      height: 480,
      top: 80,
      right: 960,
      bottom: 560,
      left: 320,
      toJSON: () => ({}),
    })
    mocks.openBrowserPreview.mockResolvedValue(mocks.state())
    mocks.reloadBrowserPreview.mockResolvedValue(mocks.state())
  })

  it('keeps an empty browser native-free until a destination is submitted', async () => {
    render(
      <BrowserPreviewPanel
        tab={{ ...INITIAL_TAB, kind: 'launcher', url: '', title: 'New tab' }}
        onClose={vi.fn()}
        onError={callbacks.onError}
        onFloat={callbacks.onFloat}
        onMaterialize={callbacks.onMaterialize}
        onUpdate={callbacks.onUpdate}
      />,
    )

    expect(await screen.findByRole('region', { name: 'Browser launcher' })).toBeInTheDocument()
    expect(mocks.openBrowserPreview).not.toHaveBeenCalled()
    fireEvent.change(screen.getByRole('textbox', { name: 'Preview address' }), {
      target: { value: 'localhost:3000' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))

    expect(callbacks.onMaterialize).toHaveBeenCalledExactlyOnceWith(
      'http://localhost:3000/',
      'default',
    )
    expect(mocks.openBrowserPreview).not.toHaveBeenCalled()
  })

  it('falls back exactly once when a terminal link cannot create its native preview', async () => {
    registerBrowserPreviewExternalFallback(INITIAL_TAB.id, 'http://127.0.0.1:5173/')
    mocks.openBrowserPreview.mockRejectedValueOnce(new Error('native view unavailable'))

    render(<PreviewHarness />)

    await waitFor(() =>
      expect(mocks.openExternal).toHaveBeenCalledExactlyOnceWith('http://127.0.0.1:5173/'),
    )
    expect(mocks.closeBrowserPreview).toHaveBeenCalledExactlyOnceWith(INITIAL_TAB.id)
  })

  it('falls back exactly once when Chromium later reports navigation failure', async () => {
    registerBrowserPreviewExternalFallback(INITIAL_TAB.id, 'http://127.0.0.1:5173/')
    mocks.openBrowserPreview.mockResolvedValueOnce({ ...mocks.state(), loading: true })
    render(<PreviewHarness />)
    await waitFor(() => expect(mocks.openBrowserPreview).toHaveBeenCalledOnce())

    act(() =>
      mocks.emitState({
        ...mocks.state('http://127.0.0.1:5173/'),
        error: {
          code: '-102',
          description: 'Connection refused',
          url: 'http://127.0.0.1:5173/',
        },
      }),
    )

    await waitFor(() =>
      expect(mocks.openExternal).toHaveBeenCalledExactlyOnceWith('http://127.0.0.1:5173/'),
    )
    expect(mocks.closeBrowserPreview).toHaveBeenCalledExactlyOnceWith(INITIAL_TAB.id)
  })

  it('opens at native viewport bounds without reopening for title updates', async () => {
    render(<PreviewHarness />)

    await waitFor(() => {
      expect(mocks.openBrowserPreview).toHaveBeenCalledExactlyOnceWith({
        previewId: expect.any(String),
        ownerKey: 'session-1',
        profileId: 'default',
        url: 'https://example.com/',
        bounds: { x: 320, y: 80, width: 640, height: 480 },
        visible: true,
        audioMuted: false,
        initialControls: {
          viewport: { mode: 'fill' },
          zoomFactor: 1,
          appearance: 'system',
        },
      })
    })
    const previewId = INITIAL_TAB.id

    act(() => mocks.emitState({ ...mocks.state(), previewId, title: 'Updated title' }))

    expect(await screen.findByDisplayValue('https://example.com/')).toBeInTheDocument()
    expect(callbacks.onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Updated title' }),
    )
    expect(mocks.openBrowserPreview).toHaveBeenCalledOnce()
  })

  it('ignores state from another owner or a replaced native profile', async () => {
    render(<PreviewHarness />)
    await waitFor(() => expect(mocks.openBrowserPreview).toHaveBeenCalledOnce())
    callbacks.onUpdate.mockClear()

    act(() => mocks.emitState({ ...mocks.state(), ownerKey: 'session-2', title: 'Other owner' }))
    act(() => mocks.emitState({ ...mocks.state(), profileId: 'stale-profile', title: 'Old view' }))

    expect(callbacks.onUpdate).not.toHaveBeenCalled()

    mocks.reloadBrowserPreview.mockResolvedValueOnce({
      ...mocks.state(),
      profileId: 'stale-profile',
      title: 'Late reload',
    })
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    await waitFor(() => expect(mocks.reloadBrowserPreview).toHaveBeenCalledOnce())
    expect(callbacks.onUpdate).not.toHaveBeenCalled()
  })

  it('shows controller ownership and floats the same retained preview over chat', async () => {
    render(<PreviewHarness />)

    expect(await screen.findByText('Human control')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Float preview over chat' }))

    expect(callbacks.onFloat).toHaveBeenCalledOnce()
    expect(useBrowserPreviewFloatingStore.getState().byOwnerKey['session-1']).toMatchObject({
      previewId: INITIAL_TAB.id,
    })
    expect(screen.getByRole('button', { name: 'Close floating preview' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Close floating preview' }))
    expect(useBrowserPreviewFloatingStore.getState().byOwnerKey['session-1']).toBeUndefined()
    expect(callbacks.onFloat).toHaveBeenCalledOnce()

    act(() =>
      mocks.emitState({
        ...mocks.state(),
        controller: { kind: 'agent', action: 'click', pointer: { x: 24, y: 42 } },
      }),
    )
    expect(await screen.findByText('Agent controlling browser')).toBeInTheDocument()
  })

  it('handles native location and close shortcuts in the React chrome', async () => {
    render(<PreviewHarness />)
    const address = await screen.findByRole('textbox', { name: 'Preview address' })
    const previewId = INITIAL_TAB.id

    act(() => mocks.emitShortcut({ previewId, action: 'focus-location' }))
    expect(address).toHaveFocus()

    act(() => mocks.emitShortcut({ previewId, action: 'close' }))
    await waitFor(() => expect(mocks.closeBrowserPreview).toHaveBeenCalledWith(previewId))
    expect(screen.queryByRole('textbox', { name: 'Preview address' })).not.toBeInTheDocument()
  })

  it('recreates a crashed native view when reload is no longer available', async () => {
    render(<PreviewHarness />)
    const previewId = INITIAL_TAB.id
    await waitFor(() => expect(mocks.openBrowserPreview).toHaveBeenCalledOnce())
    act(() =>
      mocks.emitState({
        ...mocks.state(),
        previewId,
        error: {
          code: 'RENDERER_GONE',
          description: 'Preview crashed.',
          url: 'https://example.com/',
        },
      }),
    )
    mocks.reloadBrowserPreview.mockRejectedValueOnce(new Error('Preview not found'))

    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }))

    await waitFor(() =>
      expect(mocks.reloadBrowserPreview).toHaveBeenCalledExactlyOnceWith(previewId),
    )
    await waitFor(() => expect(mocks.openBrowserPreview).toHaveBeenCalledTimes(2))
  })

  it('hides the native view while a native dialog is open', async () => {
    const dialog = document.createElement('dialog')
    document.body.append(dialog)
    render(<PreviewHarness />)
    const previewId = INITIAL_TAB.id
    await waitFor(() => expect(mocks.openBrowserPreview).toHaveBeenCalledOnce())
    mocks.setBrowserPreviewBounds.mockClear()

    dialog.open = true

    await waitFor(() => {
      expect(mocks.setBrowserPreviewBounds).toHaveBeenCalledWith(previewId, null)
    })
    dialog.remove()
  })
})
