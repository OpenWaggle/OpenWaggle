import {
  BROWSER_PREVIEW_VIEWPORT_MAX_AREA,
  BROWSER_PREVIEW_VIEWPORT_MAX_DIMENSION,
  BROWSER_PREVIEW_VIEWPORT_MIN_DIMENSION,
} from '@shared/browser-preview-viewports'
import type {
  BrowserPreviewFixedViewport,
  BrowserPreviewViewport,
} from '@shared/types/browser-preview-controls'

export interface BrowserPreviewDeviceLayout {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  /** Presentation-only scale; the guest keeps the requested CSS viewport. */
  readonly scale: number
  readonly fillsContainer: boolean
}

const CENTERING_DIVISOR = 2
export const BROWSER_PREVIEW_VIEWPORT_RESIZE_RAIL_SIZE = 10

function normalizedZoom(zoomFactor: number) {
  return Number.isFinite(zoomFactor) && zoomFactor > 0 ? zoomFactor : 1
}

export function resolveBrowserPreviewDeviceLayout(
  container: { readonly width: number; readonly height: number },
  viewport: BrowserPreviewViewport,
  zoomFactor = 1,
): BrowserPreviewDeviceLayout {
  const containerWidth = Math.max(1, Math.round(container.width))
  const containerHeight = Math.max(1, Math.round(container.height))
  if (viewport.mode === 'fill') {
    return {
      x: 0,
      y: 0,
      width: containerWidth,
      height: containerHeight,
      scale: 1,
      fillsContainer: true,
    }
  }
  const zoom = normalizedZoom(zoomFactor)
  const requestedWidth = viewport.width * zoom
  const requestedHeight = viewport.height * zoom
  const scale = Math.min(1, containerWidth / requestedWidth, containerHeight / requestedHeight)
  const width = Math.max(1, Math.round(requestedWidth * scale))
  const height = Math.max(1, Math.round(requestedHeight * scale))
  return {
    x: Math.max(0, Math.round((containerWidth - width) / CENTERING_DIVISOR)),
    y: Math.max(0, Math.round((containerHeight - height) / CENTERING_DIVISOR)),
    width,
    height,
    scale,
    fillsContainer: false,
  }
}

export function resolveBrowserPreviewResizeArea(container: {
  readonly width: number
  readonly height: number
}) {
  return {
    width: Math.max(
      1,
      container.width - BROWSER_PREVIEW_VIEWPORT_RESIZE_RAIL_SIZE * CENTERING_DIVISOR,
    ),
    height: Math.max(1, container.height - BROWSER_PREVIEW_VIEWPORT_RESIZE_RAIL_SIZE),
  }
}

/** Leaves an interactive rail around the visible native guest without changing its CSS viewport. */
export function resolveBrowserPreviewResizableDeviceLayout(
  container: { readonly width: number; readonly height: number },
  viewport: BrowserPreviewFixedViewport,
  zoomFactor = 1,
): BrowserPreviewDeviceLayout {
  const layout = resolveBrowserPreviewDeviceLayout(
    resolveBrowserPreviewResizeArea(container),
    viewport,
    zoomFactor,
  )
  return {
    ...layout,
    x: layout.x + BROWSER_PREVIEW_VIEWPORT_RESIZE_RAIL_SIZE,
  }
}

export function responsiveBrowserPreviewViewport(
  container: { readonly width: number; readonly height: number },
  zoomFactor = 1,
): BrowserPreviewFixedViewport {
  const zoom = normalizedZoom(zoomFactor)
  const width = Math.min(
    BROWSER_PREVIEW_VIEWPORT_MAX_DIMENSION,
    Math.max(BROWSER_PREVIEW_VIEWPORT_MIN_DIMENSION, Math.round(container.width / zoom)),
  )
  const height = Math.min(
    BROWSER_PREVIEW_VIEWPORT_MAX_DIMENSION,
    Math.max(BROWSER_PREVIEW_VIEWPORT_MIN_DIMENSION, Math.round(container.height / zoom)),
  )
  const scale = Math.min(1, Math.sqrt(BROWSER_PREVIEW_VIEWPORT_MAX_AREA / (width * height)))
  return {
    mode: 'fixed',
    width: Math.max(BROWSER_PREVIEW_VIEWPORT_MIN_DIMENSION, Math.floor(width * scale)),
    height: Math.max(BROWSER_PREVIEW_VIEWPORT_MIN_DIMENSION, Math.floor(height * scale)),
    presetId: null,
  }
}
