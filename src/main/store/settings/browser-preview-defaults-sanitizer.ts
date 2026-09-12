import { safeDecodeUnknown } from '@shared/schema'
import {
  browserPreviewAppearanceSchema,
  browserPreviewRecordingFrameRateSchema,
  browserPreviewViewportSchema,
  browserPreviewZoomFactorSchema,
} from '@shared/schemas/browser-preview-controls'
import {
  type BrowserPreviewAppearance,
  type BrowserPreviewRecordingFrameRate,
  type BrowserPreviewViewport,
  type BrowserPreviewZoomFactor,
  DEFAULT_BROWSER_PREVIEW_AUTO_SHOW_FLOATING,
  DEFAULT_BROWSER_PREVIEW_INITIAL_CONTROLS,
  DEFAULT_BROWSER_PREVIEW_RECORDING_FRAME_RATE,
} from '@shared/types/browser-preview-controls'

export function resolveBrowserDefaultViewport(raw: unknown): BrowserPreviewViewport {
  const decoded = safeDecodeUnknown(browserPreviewViewportSchema, raw)
  return decoded.success ? decoded.data : DEFAULT_BROWSER_PREVIEW_INITIAL_CONTROLS.viewport
}

export function resolveBrowserDefaultZoomFactor(raw: unknown): BrowserPreviewZoomFactor {
  const decoded = safeDecodeUnknown(browserPreviewZoomFactorSchema, raw)
  return decoded.success ? decoded.data : DEFAULT_BROWSER_PREVIEW_INITIAL_CONTROLS.zoomFactor
}

export function resolveBrowserDefaultAppearance(raw: unknown): BrowserPreviewAppearance {
  const decoded = safeDecodeUnknown(browserPreviewAppearanceSchema, raw)
  return decoded.success ? decoded.data : DEFAULT_BROWSER_PREVIEW_INITIAL_CONTROLS.appearance
}

export function resolveBrowserRecordingFrameRate(raw: unknown): BrowserPreviewRecordingFrameRate {
  const decoded = safeDecodeUnknown(browserPreviewRecordingFrameRateSchema, raw)
  return decoded.success ? decoded.data : DEFAULT_BROWSER_PREVIEW_RECORDING_FRAME_RATE
}

export function resolveBrowserAutoShowFloatingPreview(raw: unknown): boolean {
  return typeof raw === 'boolean' ? raw : DEFAULT_BROWSER_PREVIEW_AUTO_SHOW_FLOATING
}
