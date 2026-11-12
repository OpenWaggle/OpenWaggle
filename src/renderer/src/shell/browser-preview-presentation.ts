import { browserPreviewBounds } from '@/features/browser-preview'
import { api } from '@/shared/lib/ipc'

const PRESENTATION_SETTLE_TIMEOUT_MS = 500
const PRESENTATION_POLL_INTERVAL_MS = 16

function floatingViewport(previewId: string) {
  const players = document.querySelectorAll<HTMLElement>('[data-browser-preview-floating]')
  for (const player of players) {
    if (player.dataset.browserPreviewFloating !== previewId) continue
    return player.querySelector<HTMLElement>('[data-browser-preview-viewport]')
  }
  return null
}

/** Best-effort wait so an active Session reports visible only after native geometry is applied. */
export async function waitForBrowserPreviewPresentation(previewId: string) {
  const deadline = Date.now() + PRESENTATION_SETTLE_TIMEOUT_MS
  while (Date.now() <= deadline) {
    const viewport = floatingViewport(previewId)
    if (viewport !== null) {
      const bounds = browserPreviewBounds(viewport)
      if (bounds !== null) {
        await api.setBrowserPreviewBounds(previewId, bounds)
        return true
      }
    }
    await new Promise<void>((resolve) => window.setTimeout(resolve, PRESENTATION_POLL_INTERVAL_MS))
  }
  return false
}
