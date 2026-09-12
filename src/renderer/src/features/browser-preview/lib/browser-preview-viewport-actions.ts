import {
  BROWSER_PREVIEW_VIEWPORT_MAX_AREA,
  BROWSER_PREVIEW_VIEWPORT_MAX_DIMENSION,
  BROWSER_PREVIEW_VIEWPORT_MIN_DIMENSION,
} from '@shared/browser-preview-viewports'
import type {
  BrowserPreviewFixedViewport,
  BrowserPreviewViewport,
} from '@shared/types/browser-preview-controls'

export const BROWSER_PREVIEW_VIEWPORT_RESIZE_DIRECTIONS = [
  'west',
  'east',
  'south',
  'southwest',
  'southeast',
] as const

export type BrowserPreviewViewportResizeDirection =
  (typeof BROWSER_PREVIEW_VIEWPORT_RESIZE_DIRECTIONS)[number]

export interface BrowserPreviewViewportSize {
  readonly width: number
  readonly height: number
}

export const BROWSER_PREVIEW_VIEWPORT_COMMIT_TIMEOUT_MS = 15_000

export class BrowserPreviewViewportCommitTimeoutError extends Error {
  override readonly name = 'BrowserPreviewViewportCommitTimeoutError'

  constructor(readonly previewId: string) {
    super(`Timed out committing the browser viewport for preview ${previewId}`)
  }
}

type ViewportCommit = (viewport: BrowserPreviewFixedViewport) => Promise<void>

const commitTails = new Map<string, Promise<void>>()
const CENTERING_DIVISOR = 2

function normalizedScale(scale: number) {
  return Number.isFinite(scale) && scale > 0 ? scale : 1
}

export function browserPreviewViewportKey(viewport: BrowserPreviewViewport) {
  return viewport.mode === 'fill'
    ? 'fill'
    : `fixed:${String(viewport.width)}:${String(viewport.height)}:${viewport.presetId ?? ''}`
}

function clampViewportDimension(value: number) {
  return Math.min(
    BROWSER_PREVIEW_VIEWPORT_MAX_DIMENSION,
    Math.max(BROWSER_PREVIEW_VIEWPORT_MIN_DIMENSION, value),
  )
}

function validAspectRatio(aspectRatio: number | null): aspectRatio is number {
  const minimum = BROWSER_PREVIEW_VIEWPORT_MIN_DIMENSION / BROWSER_PREVIEW_VIEWPORT_MAX_DIMENSION
  const maximum = BROWSER_PREVIEW_VIEWPORT_MAX_DIMENSION / BROWSER_PREVIEW_VIEWPORT_MIN_DIMENSION
  return (
    aspectRatio !== null &&
    Number.isFinite(aspectRatio) &&
    aspectRatio >= minimum &&
    aspectRatio <= maximum
  )
}

function resizeAtAspectRatio(
  desired: number,
  aspectRatio: number,
  primaryAxis: 'width' | 'height',
): BrowserPreviewViewportSize {
  if (primaryAxis === 'width') {
    const minimum = Math.ceil(
      Math.max(
        BROWSER_PREVIEW_VIEWPORT_MIN_DIMENSION,
        BROWSER_PREVIEW_VIEWPORT_MIN_DIMENSION * aspectRatio,
      ),
    )
    const maximum = Math.floor(
      Math.min(
        BROWSER_PREVIEW_VIEWPORT_MAX_DIMENSION,
        BROWSER_PREVIEW_VIEWPORT_MAX_DIMENSION * aspectRatio,
        Math.sqrt(BROWSER_PREVIEW_VIEWPORT_MAX_AREA * aspectRatio),
      ),
    )
    let width = Math.min(maximum, Math.max(minimum, Math.round(desired)))
    let height = Math.round(width / aspectRatio)
    while (width * height > BROWSER_PREVIEW_VIEWPORT_MAX_AREA && width > minimum) {
      width -= 1
      height = Math.round(width / aspectRatio)
    }
    return { width, height }
  }

  const minimum = Math.ceil(
    Math.max(
      BROWSER_PREVIEW_VIEWPORT_MIN_DIMENSION,
      BROWSER_PREVIEW_VIEWPORT_MIN_DIMENSION / aspectRatio,
    ),
  )
  const maximum = Math.floor(
    Math.min(
      BROWSER_PREVIEW_VIEWPORT_MAX_DIMENSION,
      BROWSER_PREVIEW_VIEWPORT_MAX_DIMENSION / aspectRatio,
      Math.sqrt(BROWSER_PREVIEW_VIEWPORT_MAX_AREA / aspectRatio),
    ),
  )
  let height = Math.min(maximum, Math.max(minimum, Math.round(desired)))
  let width = Math.round(height * aspectRatio)
  while (width * height > BROWSER_PREVIEW_VIEWPORT_MAX_AREA && height > minimum) {
    height -= 1
    width = Math.round(height * aspectRatio)
  }
  return { width, height }
}

function horizontalDeltaForDirection(
  direction: BrowserPreviewViewportResizeDirection,
  delta: number,
) {
  if (direction.includes('east')) return delta
  if (direction.includes('west')) return -delta
  return 0
}

function primaryAxisForResize(
  start: BrowserPreviewViewportSize,
  desired: BrowserPreviewViewportSize,
  direction: BrowserPreviewViewportResizeDirection,
  horizontalDelta: number,
  verticalDelta: number,
): 'width' | 'height' {
  const controlsWidth = horizontalDelta !== 0 || direction === 'east' || direction === 'west'
  const controlsHeight = verticalDelta !== 0 || direction === 'south'
  if (controlsWidth && !controlsHeight) return 'width'
  if (controlsHeight && !controlsWidth) return 'height'
  const widthChange = Math.abs(desired.width - start.width) / start.width
  const heightChange = Math.abs(desired.height - start.height) / start.height
  return widthChange >= heightChange ? 'width' : 'height'
}

function fitViewportArea(
  width: number,
  height: number,
  horizontalDelta: number,
  verticalDelta: number,
): BrowserPreviewViewportSize {
  if (width * height <= BROWSER_PREVIEW_VIEWPORT_MAX_AREA) return { width, height }
  if (Math.abs(horizontalDelta) >= Math.abs(verticalDelta)) {
    return {
      width: Math.max(
        BROWSER_PREVIEW_VIEWPORT_MIN_DIMENSION,
        Math.floor(BROWSER_PREVIEW_VIEWPORT_MAX_AREA / height),
      ),
      height,
    }
  }
  return {
    width,
    height: Math.max(
      BROWSER_PREVIEW_VIEWPORT_MIN_DIMENSION,
      Math.floor(BROWSER_PREVIEW_VIEWPORT_MAX_AREA / width),
    ),
  }
}

export function resizeBrowserPreviewViewport(
  start: BrowserPreviewViewportSize,
  delta: { readonly x: number; readonly y: number },
  scale = 1,
  direction: BrowserPreviewViewportResizeDirection = 'southeast',
  aspectRatio: number | null = null,
): BrowserPreviewViewportSize {
  const resolvedScale = normalizedScale(scale)
  const horizontalDelta = horizontalDeltaForDirection(direction, delta.x)
  const verticalDelta = direction.includes('south') ? delta.y : 0
  const desired = {
    width: start.width + horizontalDelta / resolvedScale,
    height: start.height + verticalDelta / resolvedScale,
  }
  if (validAspectRatio(aspectRatio)) {
    const primaryAxis = primaryAxisForResize(
      start,
      desired,
      direction,
      horizontalDelta,
      verticalDelta,
    )
    return resizeAtAspectRatio(
      primaryAxis === 'width' ? desired.width : desired.height,
      aspectRatio,
      primaryAxis,
    )
  }
  return fitViewportArea(
    clampViewportDimension(Math.round(desired.width)),
    clampViewportDimension(Math.round(desired.height)),
    horizontalDelta,
    verticalDelta,
  )
}

function resizeFromEndRail(start: number, pointerDelta: number, available: number) {
  const startEdge = start < available ? (available + start) / CENTERING_DIVISOR : start
  const targetEdge = startEdge + pointerDelta
  return targetEdge <= available ? targetEdge * CENTERING_DIVISOR - available : targetEdge
}

function resizeFromStartRail(start: number, pointerDelta: number, available: number) {
  if (start > available) {
    const distanceToFit = start - available
    return pointerDelta <= distanceToFit
      ? start - pointerDelta
      : available - (pointerDelta - distanceToFit) * CENTERING_DIVISOR
  }
  const targetEdge = (available - start) / CENTERING_DIVISOR + pointerDelta
  return targetEdge >= 0 ? available - targetEdge * CENTERING_DIVISOR : available - targetEdge
}

export function resizeBrowserPreviewViewportFromRail(
  start: BrowserPreviewViewportSize,
  pointerDelta: { readonly x: number; readonly y: number },
  available: BrowserPreviewViewportSize,
  scale = 1,
  direction: BrowserPreviewViewportResizeDirection = 'southeast',
  aspectRatio: number | null = null,
): BrowserPreviewViewportSize {
  const resolvedScale = normalizedScale(scale)
  const startWidth = start.width * resolvedScale
  const startHeight = start.height * resolvedScale
  const desiredWidth = direction.includes('east')
    ? resizeFromEndRail(startWidth, pointerDelta.x, available.width)
    : direction.includes('west')
      ? resizeFromStartRail(startWidth, pointerDelta.x, available.width)
      : startWidth
  const desiredHeight = direction.includes('south')
    ? resizeFromEndRail(startHeight, pointerDelta.y, available.height)
    : startHeight
  const widthDelta = desiredWidth - startWidth
  const heightDelta = desiredHeight - startHeight
  return resizeBrowserPreviewViewport(
    start,
    {
      x: direction.includes('west') ? -widthDelta : widthDelta,
      y: heightDelta,
    },
    resolvedScale,
    direction,
    aspectRatio,
  )
}

function runCommitWithTimeout(previewId: string, operation: Promise<void>) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(
      () => reject(new BrowserPreviewViewportCommitTimeoutError(previewId)),
      BROWSER_PREVIEW_VIEWPORT_COMMIT_TIMEOUT_MS,
    )
  })
  return Promise.race([operation, timeout]).finally(() => {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
  })
}

/** Keeps async transports from applying an older viewport after a newer resize. */
export function commitBrowserPreviewViewportChange(
  previewId: string,
  viewport: BrowserPreviewFixedViewport,
  commit: ViewportCommit,
): Promise<void> {
  const previous = commitTails.get(previewId) ?? Promise.resolve()
  const started = previous
    .catch(() => undefined)
    .then(() => ({
      operation: Promise.resolve().then(() => commit(viewport)),
    }))
  const execution = started.then(({ operation }) => operation)
  const tail = execution.then(() => undefined)
  commitTails.set(previewId, tail)
  const clear = () => {
    if (commitTails.get(previewId) === tail) commitTails.delete(previewId)
  }
  void tail.then(clear, clear)
  return started.then(({ operation }) => runCommitWithTimeout(previewId, operation))
}
