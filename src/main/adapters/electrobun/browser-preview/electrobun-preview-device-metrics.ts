import type { BrowserPreviewBounds } from '@shared/types/browser-preview'
import type {
  BrowserPreviewAppearance,
  BrowserPreviewViewport,
} from '@shared/types/browser-preview-controls'

/** `Emulation.setDeviceMetricsOverride` parameters, or `null` to clear the override. */
export interface CdpDeviceMetrics {
  readonly width: number
  readonly height: number
  readonly deviceScaleFactor: 0
  readonly mobile: false
  readonly scale: number
}

const SCALE_PRECISION = 1_000

function rounded(value: number) {
  return Math.round(value * SCALE_PRECISION) / SCALE_PRECISION
}

/**
 * The CSS viewport and scale CEF draws a preview with. CDP has no browser zoom, so zoom is the
 * same device emulation DevTools uses: the page lays out `1/zoom` as wide as the view and is drawn
 * `zoom` times larger, which also gives media queries the zoomed width. A fixed viewport keeps its
 * CSS size and is scaled down to fit the view, as Electron's `enableDeviceEmulation` does. A
 * floating fill-mode preview keeps its source viewport (`bounds.sourceViewport`). `null`: draw the
 * page as is.
 */
export function browserPreviewDeviceMetrics(
  viewport: BrowserPreviewViewport,
  zoomFactor: number,
  bounds: BrowserPreviewBounds | null,
) {
  const source = bounds?.sourceViewport
  const fixed =
    viewport.mode === 'fixed'
      ? { width: viewport.width, height: viewport.height }
      : (source ?? null)
  if (fixed === null) {
    if (zoomFactor === 1 || bounds === null) return null
    return {
      width: Math.max(1, Math.round(bounds.width / zoomFactor)),
      height: Math.max(1, Math.round(bounds.height / zoomFactor)),
      deviceScaleFactor: 0,
      mobile: false,
      scale: rounded(zoomFactor),
    } satisfies CdpDeviceMetrics | null
  }
  const renderedWidth = Math.max(1, fixed.width * zoomFactor)
  const renderedHeight = Math.max(1, fixed.height * zoomFactor)
  const fit =
    bounds === null ? 1 : Math.min(1, bounds.width / renderedWidth, bounds.height / renderedHeight)
  return {
    width: Math.max(1, Math.round(fixed.width)),
    height: Math.max(1, Math.round(fixed.height)),
    deviceScaleFactor: 0,
    mobile: false,
    scale: rounded(zoomFactor * fit),
  } satisfies CdpDeviceMetrics | null
}

/** `Emulation.setEmulatedMedia` features for an appearance; `system` follows the OS. */
export function browserPreviewColorSchemeFeatures(appearance: BrowserPreviewAppearance) {
  return appearance === 'system' ? [] : [{ name: 'prefers-color-scheme', value: appearance }]
}
