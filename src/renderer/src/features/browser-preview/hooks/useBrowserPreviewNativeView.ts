import type { BrowserPreviewBounds, BrowserPreviewState } from '@shared/types/browser-preview'
import { useEffect, useRef, useState } from 'react'
import { usePreferencesStore } from '@/features/settings/state'
import { api } from '@/shared/lib/ipc'
import type { BrowserPreviewPanelCallbacks, BrowserPreviewTab } from '../browser-preview-model'
import {
  browserPreviewExternalFallbackForState,
  clearBrowserPreviewExternalFallback,
  takeBrowserPreviewExternalFallback,
} from '../lib/browser-preview-external-fallback'
import {
  browserPreviewBounds,
  HIDDEN_BROWSER_PREVIEW_BOUNDS,
  observeBrowserPreviewBounds,
  pageHasOccludingDialog,
} from '../lib/browser-preview-native-bounds'

interface NativeViewOptions extends Pick<BrowserPreviewPanelCallbacks, 'onClose' | 'onError'> {
  readonly addressRef: React.RefObject<HTMLInputElement | null>
  readonly onState: (state: BrowserPreviewState) => void
  readonly tab: BrowserPreviewTab
  readonly viewportRef: React.RefObject<HTMLDivElement | null>
  readonly sourceViewport?: BrowserPreviewBounds['sourceViewport']
}

// Bounds IPC targets the tab id, even when its immutable profile view is replaced.
const activePresentations = new Map<string, symbol>()

function reportExternalFallbackFailure(options: NativeViewOptions, error: unknown) {
  options.onError(
    error instanceof Error
      ? `Preview and system browser failed: ${error.message}`
      : 'Preview and system browser could not open the link.',
  )
}

async function openExternalFallback(options: NativeViewOptions, url: string) {
  try {
    await api.openExternal(url)
  } catch (error) {
    reportExternalFallbackFailure(options, error)
  }
}

function applyNativeState(options: NativeViewOptions, state: BrowserPreviewState) {
  if (
    state.previewId !== options.tab.id ||
    state.ownerKey !== options.tab.ownerKey ||
    state.profileId !== options.tab.profileId
  ) {
    return
  }
  const fallbackUrl = browserPreviewExternalFallbackForState(state)
  if (fallbackUrl === null) {
    options.onState(state)
    return
  }
  void openExternalFallback(options, fallbackUrl)
  options.onClose()
  options.onError('Preview could not load in-app. Opening the link in your system browser.')
}

/** Owns the native view and keeps changing React callbacks out of its lifetime. */
export function useBrowserPreviewNativeView(options: NativeViewOptions) {
  const latestRef = useRef(options)
  const previewId = options.tab.id
  const ownerKey = options.tab.ownerKey
  const profileId = options.tab.profileId
  const presentationKey = `${ownerKey}\0${previewId}\0${profileId}`
  const [readyKey, setReadyKey] = useState<string | null>(null)
  useEffect(() => {
    latestRef.current = options
  }, [options])

  useEffect(
    () => api.onBrowserPreviewState((state) => applyNativeState(latestRef.current, state)),
    [],
  )

  useEffect(
    () =>
      api.onBrowserPreviewShortcut((shortcut) => {
        const latest = latestRef.current
        if (shortcut.previewId !== latest.tab.id) return
        if (shortcut.action === 'focus-location') {
          latest.addressRef.current?.focus()
          latest.addressRef.current?.select()
          return
        }
        latest.onClose()
      }),
    [],
  )

  useEffect(() => {
    const latest = latestRef.current
    const viewport = latest.viewportRef.current
    if (viewport === null) return
    let disposed = false
    const presentation = Symbol(presentationKey)
    activePresentations.set(previewId, presentation)
    let disposeBounds: (() => void) | undefined
    const settings = usePreferencesStore.getState().settings
    void api
      .registerBrowserPreviewOwner(ownerKey)
      .then(() => {
        if (disposed) return null
        const visibleBounds = pageHasOccludingDialog(ownerKey)
          ? null
          : browserPreviewBounds(viewport, latestRef.current.sourceViewport)
        return api.openBrowserPreview({
          previewId,
          ownerKey,
          profileId,
          url: latest.tab.url,
          bounds: visibleBounds ?? HIDDEN_BROWSER_PREVIEW_BOUNDS,
          visible: visibleBounds !== null,
          audioMuted: latest.tab.audioMuted,
          initialControls: {
            viewport: settings.browserDefaultViewport,
            zoomFactor: settings.browserDefaultZoomFactor,
            appearance: settings.browserDefaultAppearance,
          },
        })
      })
      .then((state) => {
        if (state === null) return
        if (disposed) {
          if (!activePresentations.has(previewId)) {
            void api.setBrowserPreviewBounds(previewId, null).catch(() => undefined)
          }
          return
        }
        disposeBounds = observeBrowserPreviewBounds({
          ownerKey,
          previewId,
          viewport,
          hasError: () => latestRef.current.tab.error !== null,
          sourceViewport: () => latestRef.current.sourceViewport,
        })
        setReadyKey(presentationKey)
        applyNativeState(latestRef.current, state)
      })
      .catch(async (error: unknown) => {
        if (disposed) return
        const current = latestRef.current
        const fallbackUrl = takeBrowserPreviewExternalFallback(previewId) ?? current.tab.url
        const openingFallback = openExternalFallback(current, fallbackUrl)
        current.onClose()
        current.onError(
          error instanceof Error
            ? `Preview unavailable: ${error.message}. Opening the system browser.`
            : 'Preview unavailable. Opening the system browser.',
        )
        await openingFallback
      })
    return () => {
      disposed = true
      if (activePresentations.get(previewId) === presentation) {
        activePresentations.delete(previewId)
      }
      clearBrowserPreviewExternalFallback(previewId)
      disposeBounds?.()
    }
  }, [ownerKey, previewId, profileId, presentationKey])
  return readyKey === presentationKey
}
