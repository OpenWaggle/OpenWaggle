import type { PreparedAttachment } from './agent'

export const BROWSER_PREVIEW_APPEARANCES = ['system', 'light', 'dark'] as const
export type BrowserPreviewAppearance = (typeof BROWSER_PREVIEW_APPEARANCES)[number]

/** Chrome's stable zoom ladder, shared by the settings picker and new-tab defaults. */
export const BROWSER_PREVIEW_ZOOM_FACTORS = [
  0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5,
] as const
export type BrowserPreviewZoomFactor = (typeof BROWSER_PREVIEW_ZOOM_FACTORS)[number]

export const BROWSER_PREVIEW_RECORDING_FRAME_RATES = [30, 60] as const
export type BrowserPreviewRecordingFrameRate =
  (typeof BROWSER_PREVIEW_RECORDING_FRAME_RATES)[number]

export interface BrowserPreviewFillViewport {
  readonly mode: 'fill'
}

export interface BrowserPreviewFixedViewport {
  readonly mode: 'fixed'
  readonly width: number
  readonly height: number
  readonly presetId: BrowserPreviewViewportPresetId | null
}

export type BrowserPreviewViewport = BrowserPreviewFillViewport | BrowserPreviewFixedViewport

export interface BrowserPreviewArtifact {
  readonly id: string
  readonly previewId: string
  readonly path: string
  readonly mimeType: string
  readonly sizeBytes: number
  readonly createdAt: string
}

export interface BrowserPreviewScreenshotArtifact extends BrowserPreviewArtifact {
  readonly mimeType: 'image/png'
  readonly width: number
  readonly height: number
}

export interface BrowserPreviewRecordingArtifact extends BrowserPreviewArtifact {
  readonly mimeType: BrowserPreviewRecordingMimeType
  readonly durationMs: number
}

export interface BrowserPreviewRecordingGrant {
  readonly maxBytes: number
  readonly maxDurationMs: number
  readonly maxFrameRate: number
}

export interface BrowserPreviewRecordingSaveInput {
  readonly previewId: string
  readonly mimeType: BrowserPreviewRecordingMimeType
  readonly data: Uint8Array
  readonly durationMs: number
}

export const BROWSER_PREVIEW_RECORDING_MIME_TYPES = [
  'video/mp4;codecs=avc1',
  'video/mp4;codecs=avc1.640028',
  'video/mp4;codecs=avc1.42e01e',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
  'video/mp4',
  'video/webm;codecs=av1',
] as const

export type BrowserPreviewRecordingMimeType = (typeof BROWSER_PREVIEW_RECORDING_MIME_TYPES)[number]

export interface BrowserPreviewAnnotationRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface BrowserPreviewAnnotationPoint {
  readonly x: number
  readonly y: number
}

export interface BrowserPreviewElementStackFrame {
  readonly functionName: string | null
  readonly fileName: string | null
  readonly lineNumber: number | null
  readonly columnNumber: number | null
}

export interface BrowserPreviewElementContext {
  readonly selector: string
  readonly tagName: string
  readonly id: string | null
  readonly classes: readonly string[]
  readonly role: string | null
  readonly accessibleName: string | null
  readonly text: string
  readonly rect: BrowserPreviewAnnotationRect
  readonly htmlPreview: string
  readonly componentName: string | null
  readonly source: BrowserPreviewElementStackFrame | null
  readonly stack: readonly BrowserPreviewElementStackFrame[]
  readonly styles: string
  readonly pickedAt: string
}

export interface BrowserPreviewAnnotationElementTarget {
  readonly id: string
  readonly element: BrowserPreviewElementContext
  readonly rect: BrowserPreviewAnnotationRect
}

export interface BrowserPreviewAnnotationRegionTarget {
  readonly id: string
  readonly rect: BrowserPreviewAnnotationRect
}

export interface BrowserPreviewAnnotationStrokeTarget {
  readonly id: string
  readonly color: string
  readonly width: number
  readonly points: readonly BrowserPreviewAnnotationPoint[]
  readonly bounds: BrowserPreviewAnnotationRect
}

export const BROWSER_PREVIEW_ANNOTATION_STYLE_PROPERTIES = [
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'color',
  'background-color',
  'opacity',
  'border-radius',
  'border-color',
  'border-style',
  'border-width',
  'width',
  'height',
  'padding',
  'margin',
  'gap',
] as const

export type BrowserPreviewAnnotationStyleProperty =
  (typeof BROWSER_PREVIEW_ANNOTATION_STYLE_PROPERTIES)[number]

export interface BrowserPreviewAnnotationStyleChange {
  readonly targetId: string
  readonly selector: string
  readonly property: BrowserPreviewAnnotationStyleProperty
  readonly previousValue: string
  readonly value: string
}

export const BROWSER_PREVIEW_ANNOTATION_VERSION = 2

export interface BrowserPreviewAnnotation {
  readonly id: string
  readonly previewId: string
  readonly pageUrl: string
  readonly pageTitle: string
  readonly comment: string
  /** First selected element for compatibility with the original single-element picker. */
  readonly element: BrowserPreviewElementContext | null
  readonly elements: readonly BrowserPreviewAnnotationElementTarget[]
  readonly regions: readonly BrowserPreviewAnnotationRegionTarget[]
  readonly strokes: readonly BrowserPreviewAnnotationStrokeTarget[]
  readonly styleChanges: readonly BrowserPreviewAnnotationStyleChange[]
  readonly captureRect: BrowserPreviewAnnotationRect
  readonly createdAt: string
  readonly screenshot: BrowserPreviewScreenshotArtifact | null
  readonly attachment: PreparedAttachment | null
}

export interface BrowserPreviewElementPickPayload {
  readonly version: typeof BROWSER_PREVIEW_ANNOTATION_VERSION
  readonly pageUrl: string
  readonly pageTitle: string
  readonly comment: string
  readonly elements: readonly BrowserPreviewAnnotationElementTarget[]
  readonly regions: readonly BrowserPreviewAnnotationRegionTarget[]
  readonly strokes: readonly BrowserPreviewAnnotationStrokeTarget[]
  readonly styleChanges: readonly BrowserPreviewAnnotationStyleChange[]
  readonly captureRect: BrowserPreviewAnnotationRect
}

export interface BrowserPreviewControlState {
  readonly zoomFactor: number
  readonly appearance: BrowserPreviewAppearance
  readonly viewport: BrowserPreviewViewport
  readonly pictureInPicture: boolean
  readonly picking: boolean
  readonly recording: boolean
}

/** Immutable starting controls supplied before a new guest paints its first frame. */
export interface BrowserPreviewInitialControls {
  /** Any bounded Chromium zoom value, including 0.1 steps produced by preview controls. */
  readonly zoomFactor: number
  readonly appearance: BrowserPreviewAppearance
  readonly viewport: BrowserPreviewViewport
}

export const DEFAULT_BROWSER_PREVIEW_INITIAL_CONTROLS: BrowserPreviewInitialControls & {
  readonly zoomFactor: BrowserPreviewZoomFactor
} = {
  zoomFactor: 1,
  appearance: 'system',
  viewport: { mode: 'fill' },
}

export const DEFAULT_BROWSER_PREVIEW_RECORDING_FRAME_RATE: BrowserPreviewRecordingFrameRate = 30
export const DEFAULT_BROWSER_PREVIEW_AUTO_SHOW_FLOATING = true

export const DEFAULT_BROWSER_PREVIEW_CONTROL_STATE: BrowserPreviewControlState = {
  ...DEFAULT_BROWSER_PREVIEW_INITIAL_CONTROLS,
  pictureInPicture: false,
  picking: false,
  recording: false,
}

export const BROWSER_PREVIEW_VIEWPORT_PRESET_IDS = [
  'iphone-se',
  'iphone-xr',
  'iphone-12-pro',
  'iphone-14-pro-max',
  'pixel-7',
  'samsung-galaxy-s8-plus',
  'samsung-galaxy-s20-ultra',
  'ipad-mini',
  'ipad-air',
  'ipad-pro',
  'surface-pro-7',
  'surface-duo',
  'galaxy-z-fold-5',
  'asus-zenbook-fold',
  'samsung-galaxy-a51-71',
  'nest-hub',
  'nest-hub-max',
] as const

export type BrowserPreviewViewportPresetId = (typeof BROWSER_PREVIEW_VIEWPORT_PRESET_IDS)[number]

export const BROWSER_PREVIEW_CAPTURE_LIMITS = {
  ARTIFACT_FILES: 96,
  ARTIFACT_TOTAL_BYTES: 512 * 1024 * 1024,
  SCREENSHOT_BYTES: 24 * 1024 * 1024,
  SCREENSHOT_PIXELS: 16_777_216,
  RECORDING_BYTES: 64 * 1024 * 1024,
  RECORDING_DURATION_MS: 120_000,
  RECORDING_FRAME_RATE: 60,
  PICK_TEXT_LENGTH: 500,
  PICK_SELECTOR_LENGTH: 2_048,
  PICK_CLASSES: 16,
  PICK_ELEMENTS: 20,
  PICK_REGIONS: 20,
  PICK_STROKES: 20,
  PICK_STROKE_POINTS: 256,
  PICK_STROKE_MIN_POINTS: 2,
  PICK_STACK_FRAMES: 16,
  PICK_HTML_LENGTH: 4_000,
  PICK_STYLES_LENGTH: 4_000,
  PICK_COMPONENT_LENGTH: 256,
  PICK_SOURCE_LENGTH: 2_048,
  PICK_STYLE_VALUE_LENGTH: 512,
  PICK_TARGET_ID_LENGTH: 128,
  PICK_TOTAL_BYTES: 512 * 1_024,
} as const
