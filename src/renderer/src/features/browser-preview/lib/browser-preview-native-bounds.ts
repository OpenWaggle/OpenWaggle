import type { BrowserPreviewBounds } from '@shared/types/browser-preview'
import { BROWSER_PREVIEW_LIMITS } from '@shared/types/browser-preview'
import { api } from '@/shared/lib/ipc'

export const HIDDEN_BROWSER_PREVIEW_BOUNDS = { x: 0, y: 0, width: 1, height: 1 } as const

export function browserPreviewSourceViewport(element: HTMLElement | null, zoomFactor: number) {
  const bounds = element?.getBoundingClientRect()
  if (!bounds || bounds.width < 1 || bounds.height < 1) return undefined
  const zoom = Number.isFinite(zoomFactor) && zoomFactor > 0 ? zoomFactor : 1
  return {
    width: Math.min(BROWSER_PREVIEW_LIMITS.MAX_DIP, Math.max(1, Math.round(bounds.width / zoom))),
    height: Math.min(BROWSER_PREVIEW_LIMITS.MAX_DIP, Math.max(1, Math.round(bounds.height / zoom))),
  }
}

export function browserPreviewBounds(
  element: HTMLElement,
  sourceViewport?: BrowserPreviewBounds['sourceViewport'],
) {
  const bounds = element.getBoundingClientRect()
  if (bounds.width < 1 || bounds.height < 1) return null
  return {
    x: Math.max(0, Math.round(bounds.x)),
    y: Math.max(0, Math.round(bounds.y)),
    width: Math.max(1, Math.round(bounds.width)),
    height: Math.max(1, Math.round(bounds.height)),
    ...(sourceViewport === undefined ? {} : { sourceViewport }),
  }
}

export function pageHasOccludingDialog(ownerKey?: string) {
  return (
    document.querySelector(
      'dialog[open]:not([inert]), [role="dialog"]:not([inert]):not([aria-hidden="true"])',
    ) !== null ||
    (ownerKey !== undefined &&
      [...document.querySelectorAll<HTMLElement>('[data-native-preview-occluder]')].some(
        (element) => element.dataset.nativePreviewOccluder === ownerKey,
      ))
  )
}

interface BoundsObserverOptions {
  readonly ownerKey?: string
  readonly previewId: string
  readonly viewport: HTMLElement
  readonly hasError: () => boolean
  readonly sourceViewport?: () => BrowserPreviewBounds['sourceViewport']
}

/** Coalesces DOM geometry changes and hides the native view behind app dialogs. */
export function observeBrowserPreviewBounds(options: BoundsObserverOptions) {
  let frame: number | null = null
  let disposed = false
  const hide = () => api.setBrowserPreviewBounds(options.previewId, null).catch(() => undefined)
  const synchronize = () => {
    if (frame !== null) cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      frame = null
      if (disposed) return
      if (
        document.visibilityState !== 'visible' ||
        options.hasError() ||
        pageHasOccludingDialog(options.ownerKey)
      ) {
        void hide()
        return
      }
      void api
        .setBrowserPreviewBounds(
          options.previewId,
          browserPreviewBounds(options.viewport, options.sourceViewport?.()),
        )
        .catch(() => undefined)
    })
  }
  const resizeObserver = new ResizeObserver(synchronize)
  const mutationObserver = new MutationObserver(synchronize)
  resizeObserver.observe(options.viewport)
  mutationObserver.observe(document.body, {
    attributeFilter: ['aria-hidden', 'inert', 'open', 'role', 'data-native-preview-occluder'],
    attributes: true,
    childList: true,
    subtree: true,
  })
  window.addEventListener('resize', synchronize)
  window.addEventListener('scroll', synchronize, true)
  document.addEventListener('visibilitychange', synchronize)
  synchronize()

  return () => {
    disposed = true
    if (frame !== null) cancelAnimationFrame(frame)
    resizeObserver.disconnect()
    mutationObserver.disconnect()
    window.removeEventListener('resize', synchronize)
    window.removeEventListener('scroll', synchronize, true)
    document.removeEventListener('visibilitychange', synchronize)
    void hide()
  }
}
