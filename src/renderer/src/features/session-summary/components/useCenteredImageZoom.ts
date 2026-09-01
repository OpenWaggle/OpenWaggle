import { useLayoutEffect, useRef } from 'react'
import type { ImageViewerZoom as Zoom } from './SessionResourceViewerCanvas'

const CENTER_RATIO = 0.5

interface ViewportCenter {
  readonly resourceId: string
  readonly zoom: Zoom
  readonly x: number
  readonly y: number
}

function centerRatio(scrollOffset: number, viewportSize: number, contentSize: number) {
  if (contentSize <= 0) return CENTER_RATIO
  return Math.min(1, Math.max(0, (scrollOffset + viewportSize * CENTER_RATIO) / contentSize))
}

function centeredScrollOffset(ratio: number, viewportSize: number, contentSize: number) {
  const maximum = Math.max(0, contentSize - viewportSize)
  return Math.min(maximum, Math.max(0, ratio * contentSize - viewportSize * CENTER_RATIO))
}

export function useCenteredImageZoom(resourceId: string | null, zoom: Zoom) {
  const viewportRef = useRef<HTMLElement>(null)
  const centerRef = useRef<ViewportCenter>(null)

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    const center = centerRef.current
    if (!viewport || !resourceId || center?.resourceId !== resourceId || center.zoom !== zoom)
      return
    viewport.scrollLeft = centeredScrollOffset(center.x, viewport.clientWidth, viewport.scrollWidth)
    viewport.scrollTop = centeredScrollOffset(
      center.y,
      viewport.clientHeight,
      viewport.scrollHeight,
    )
    centerRef.current = null
  }, [resourceId, zoom])

  return {
    viewportRef,
    captureCenter: (nextZoom: Zoom) => {
      const viewport = viewportRef.current
      if (!viewport || !resourceId) return
      const fitCenter = zoom === 'fit' ? CENTER_RATIO : null
      centerRef.current = {
        resourceId,
        zoom: nextZoom,
        x:
          fitCenter ?? centerRatio(viewport.scrollLeft, viewport.clientWidth, viewport.scrollWidth),
        y:
          fitCenter ??
          centerRatio(viewport.scrollTop, viewport.clientHeight, viewport.scrollHeight),
      }
    },
  }
}
