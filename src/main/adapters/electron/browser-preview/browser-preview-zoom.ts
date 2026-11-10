import type { BrowserPreviewZoomAction } from '@shared/types/browser-preview'

const MIN_ZOOM_FACTOR = 0.25
const MAX_ZOOM_FACTOR = 5
const RESET_ZOOM_FACTOR = 1
const ZOOM_FACTOR_STEP = 0.1
const ZOOM_FACTOR_PRECISION = 10

export function nextBrowserPreviewZoomFactor(current: number, action: BrowserPreviewZoomAction) {
  if (action === 'reset') return RESET_ZOOM_FACTOR
  const delta = action === 'in' ? ZOOM_FACTOR_STEP : -ZOOM_FACTOR_STEP
  const rounded = Math.round((current + delta) * ZOOM_FACTOR_PRECISION) / ZOOM_FACTOR_PRECISION
  return Math.min(MAX_ZOOM_FACTOR, Math.max(MIN_ZOOM_FACTOR, rounded))
}
