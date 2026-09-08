import type {
  BrowserPreviewFloatingPosition,
  BrowserPreviewFloatingSize,
} from '../state/browser-preview-floating-store'

export const BROWSER_PREVIEW_FLOATING_EDGE_GAP = 12
export const BROWSER_PREVIEW_FLOATING_DEFAULT_SIZE = { width: 320, height: 200 } as const
export const BROWSER_PREVIEW_FLOATING_MIN_SIZE = { width: 240, height: 150 } as const
const EDGE_COUNT = 2
export const FLOATING_FRAME_CHROME = { width: 10, height: 38 } as const
export type FloatingResizeDirection =
  | 'north'
  | 'south'
  | 'east'
  | 'west'
  | 'northeast'
  | 'northwest'
  | 'southeast'
  | 'southwest'
export interface FloatingFrame extends BrowserPreviewFloatingSize, BrowserPreviewFloatingPosition {}

function finite(value: number, fallback: number) {
  return Number.isFinite(value) ? value : fallback
}

function sourceGeometry(source: BrowserPreviewFloatingSize) {
  const width = Math.max(1, finite(source.width, 1))
  const height = Math.max(1, finite(source.height, 1))
  return { width, height, ratio: width / height }
}

/** The stored width is user intent; fitting never overwrites it when chat temporarily shrinks. */
export function fitBrowserPreviewFloatingFrame(
  desired: BrowserPreviewFloatingSize | null,
  position: BrowserPreviewFloatingPosition | null,
  container: BrowserPreviewFloatingSize,
  source: BrowserPreviewFloatingSize,
): FloatingFrame {
  const { width: sourceWidth, ratio } = sourceGeometry(source)
  const maxWidth = Math.max(
    1,
    finite(container.width, 1) -
      BROWSER_PREVIEW_FLOATING_EDGE_GAP * EDGE_COUNT -
      FLOATING_FRAME_CHROME.width,
  )
  const maxHeight = Math.max(
    1,
    finite(container.height, 1) -
      BROWSER_PREVIEW_FLOATING_EDGE_GAP * EDGE_COUNT -
      FLOATING_FRAME_CHROME.height,
  )
  const preferredWidth =
    (desired === null
      ? undefined
      : finite(desired.width, BROWSER_PREVIEW_FLOATING_DEFAULT_SIZE.width)) ??
    Math.min(
      BROWSER_PREVIEW_FLOATING_DEFAULT_SIZE.width,
      BROWSER_PREVIEW_FLOATING_DEFAULT_SIZE.width * ratio,
    )
  const contentWidth = Math.min(
    sourceWidth,
    maxWidth,
    maxHeight * ratio,
    Math.max(
      preferredWidth - FLOATING_FRAME_CHROME.width,
      BROWSER_PREVIEW_FLOATING_MIN_SIZE.width - FLOATING_FRAME_CHROME.width,
      (BROWSER_PREVIEW_FLOATING_MIN_SIZE.height - FLOATING_FRAME_CHROME.height) * ratio,
    ),
  )
  const size = {
    width: contentWidth + FLOATING_FRAME_CHROME.width,
    height: contentWidth / ratio + FLOATING_FRAME_CHROME.height,
  }
  const origin = position ?? {
    x: container.width - size.width - BROWSER_PREVIEW_FLOATING_EDGE_GAP,
    y: BROWSER_PREVIEW_FLOATING_EDGE_GAP,
  }
  return { ...size, ...clampBrowserPreviewFloatingPosition(origin, container, size) }
}

/** Opposite edges stay anchored, including when a resize hits the containing chat edge. */
export function resizeBrowserPreviewFloatingFrame(
  origin: FloatingFrame,
  direction: FloatingResizeDirection,
  delta: BrowserPreviewFloatingPosition,
  container: BrowserPreviewFloatingSize,
  source: BrowserPreviewFloatingSize,
): FloatingFrame {
  const west = direction.includes('west')
  const north = direction.includes('north')
  const horizontal = west || direction.includes('east')
  const vertical = north || direction.includes('south')
  const { ratio } = sourceGeometry(source)
  const dx = horizontal ? delta.x * (west ? -1 : 1) : 0
  const dy = vertical ? delta.y * (north ? -1 : 1) * ratio : 0
  const change = Math.abs(dx) >= Math.abs(dy) ? dx : dy
  const availableWidth = west ? origin.x + origin.width : container.width - origin.x
  const availableHeight = north ? origin.y + origin.height : container.height - origin.y
  const gap = BROWSER_PREVIEW_FLOATING_EDGE_GAP
  const size = fitBrowserPreviewFloatingFrame(
    { width: origin.width + change, height: origin.height },
    null,
    { width: availableWidth + gap, height: availableHeight + gap },
    source,
  )
  const position = {
    x: west ? origin.x + origin.width - size.width : origin.x,
    y: north ? origin.y + origin.height - size.height : origin.y,
  }
  return {
    width: size.width,
    height: size.height,
    ...clampBrowserPreviewFloatingPosition(position, container, size),
  }
}

export function clampBrowserPreviewFloatingSize(
  size: BrowserPreviewFloatingSize,
  container: BrowserPreviewFloatingSize,
): BrowserPreviewFloatingSize {
  const availableWidth = Math.max(
    1,
    finite(container.width, 1) - BROWSER_PREVIEW_FLOATING_EDGE_GAP * EDGE_COUNT,
  )
  const availableHeight = Math.max(
    1,
    finite(container.height, 1) - BROWSER_PREVIEW_FLOATING_EDGE_GAP * EDGE_COUNT,
  )
  return {
    width: Math.round(
      Math.min(
        Math.max(BROWSER_PREVIEW_FLOATING_MIN_SIZE.width, finite(size.width, 1)),
        availableWidth,
      ),
    ),
    height: Math.round(
      Math.min(
        Math.max(BROWSER_PREVIEW_FLOATING_MIN_SIZE.height, finite(size.height, 1)),
        availableHeight,
      ),
    ),
  }
}

export function clampBrowserPreviewFloatingPosition(
  position: BrowserPreviewFloatingPosition,
  container: BrowserPreviewFloatingSize,
  player: BrowserPreviewFloatingSize,
): BrowserPreviewFloatingPosition {
  const maxX = Math.max(
    BROWSER_PREVIEW_FLOATING_EDGE_GAP,
    finite(container.width, 1) - player.width - BROWSER_PREVIEW_FLOATING_EDGE_GAP,
  )
  const maxY = Math.max(
    BROWSER_PREVIEW_FLOATING_EDGE_GAP,
    finite(container.height, 1) - player.height - BROWSER_PREVIEW_FLOATING_EDGE_GAP,
  )
  return {
    x: Math.round(
      Math.min(
        Math.max(
          finite(position.x, BROWSER_PREVIEW_FLOATING_EDGE_GAP),
          BROWSER_PREVIEW_FLOATING_EDGE_GAP,
        ),
        maxX,
      ),
    ),
    y: Math.round(
      Math.min(
        Math.max(
          finite(position.y, BROWSER_PREVIEW_FLOATING_EDGE_GAP),
          BROWSER_PREVIEW_FLOATING_EDGE_GAP,
        ),
        maxY,
      ),
    ),
  }
}
