import type { BrowserPreviewState } from '@shared/types/browser-preview'

const MAX_PENDING_EXTERNAL_FALLBACKS = 64
const pendingFallbacks = new Map<string, string>()

/** Marks an in-app link whose first failed native navigation should fall back externally. */
export function registerBrowserPreviewExternalFallback(previewId: string, url: string) {
  pendingFallbacks.delete(previewId)
  pendingFallbacks.set(previewId, url)
  while (pendingFallbacks.size > MAX_PENDING_EXTERNAL_FALLBACKS) {
    const oldest = pendingFallbacks.keys().next().value
    if (oldest === undefined) return
    pendingFallbacks.delete(oldest)
  }
}

export function clearBrowserPreviewExternalFallback(previewId: string) {
  pendingFallbacks.delete(previewId)
}

export function takeBrowserPreviewExternalFallback(previewId: string) {
  const url = pendingFallbacks.get(previewId) ?? null
  pendingFallbacks.delete(previewId)
  return url
}

/** Clears a completed first load or consumes its one-shot URL after a native failure. */
export function browserPreviewExternalFallbackForState(state: BrowserPreviewState) {
  if (state.error !== null) return takeBrowserPreviewExternalFallback(state.previewId)
  if (!state.loading) clearBrowserPreviewExternalFallback(state.previewId)
  return null
}
