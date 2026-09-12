import {
  BROWSER_PREVIEW_VIEWPORT_MAX_AREA,
  BROWSER_PREVIEW_VIEWPORT_MAX_DIMENSION,
  BROWSER_PREVIEW_VIEWPORT_MIN_DIMENSION,
} from '@shared/browser-preview-viewports'
import { Schema } from '@shared/schema'
import type {
  BrowserPreviewAnnotationStyleChange,
  BrowserPreviewAppearance,
  BrowserPreviewElementPickPayload,
  BrowserPreviewInitialControls,
  BrowserPreviewRecordingFrameRate,
  BrowserPreviewRecordingSaveInput,
  BrowserPreviewViewport,
  BrowserPreviewZoomFactor,
} from '@shared/types/browser-preview-controls'
import {
  BROWSER_PREVIEW_ANNOTATION_STYLE_PROPERTIES,
  BROWSER_PREVIEW_ANNOTATION_VERSION,
  BROWSER_PREVIEW_APPEARANCES,
  BROWSER_PREVIEW_CAPTURE_LIMITS,
  BROWSER_PREVIEW_RECORDING_FRAME_RATES,
  BROWSER_PREVIEW_RECORDING_MIME_TYPES,
  BROWSER_PREVIEW_VIEWPORT_PRESET_IDS,
  BROWSER_PREVIEW_ZOOM_FACTORS,
} from '@shared/types/browser-preview-controls'

const MAX_PAGE_URL_LENGTH = 8_192
const MAX_PAGE_TITLE_LENGTH = 512
const MAX_ELEMENT_TAG_LENGTH = 64
const MAX_ELEMENT_ID_LENGTH = 512
const MAX_ELEMENT_CLASS_LENGTH = 128
const MAX_ELEMENT_ROLE_LENGTH = 128
const MAX_PREVIEW_ID_LENGTH = 128
const MIN_INITIAL_ZOOM_FACTOR = 0.25
const MAX_INITIAL_ZOOM_FACTOR = 5

const viewportDimensionSchema = Schema.Number.pipe(
  Schema.int(),
  Schema.greaterThanOrEqualTo(BROWSER_PREVIEW_VIEWPORT_MIN_DIMENSION),
  Schema.lessThanOrEqualTo(BROWSER_PREVIEW_VIEWPORT_MAX_DIMENSION),
)

const fixedViewportSchema = Schema.Struct({
  mode: Schema.Literal('fixed'),
  width: viewportDimensionSchema,
  height: viewportDimensionSchema,
  presetId: Schema.NullOr(Schema.Literal(...BROWSER_PREVIEW_VIEWPORT_PRESET_IDS)),
}).pipe(
  Schema.filter(
    ({ width, height }) =>
      width * height <= BROWSER_PREVIEW_VIEWPORT_MAX_AREA ||
      `Viewport area must not exceed ${String(BROWSER_PREVIEW_VIEWPORT_MAX_AREA)} pixels.`,
  ),
)

export const browserPreviewViewportSchema: Schema.Schema<BrowserPreviewViewport> = Schema.Union(
  Schema.Struct({ mode: Schema.Literal('fill') }),
  fixedViewportSchema,
)

export const browserPreviewAppearanceSchema: Schema.Schema<BrowserPreviewAppearance> =
  Schema.Literal(...BROWSER_PREVIEW_APPEARANCES)

export const browserPreviewZoomFactorSchema: Schema.Schema<BrowserPreviewZoomFactor> =
  Schema.Literal(...BROWSER_PREVIEW_ZOOM_FACTORS)

const browserPreviewInitialZoomFactorSchema = Schema.Number.pipe(
  Schema.finite(),
  Schema.greaterThanOrEqualTo(MIN_INITIAL_ZOOM_FACTOR),
  Schema.lessThanOrEqualTo(MAX_INITIAL_ZOOM_FACTOR),
)

export const browserPreviewRecordingFrameRateSchema: Schema.Schema<BrowserPreviewRecordingFrameRate> =
  Schema.Literal(...BROWSER_PREVIEW_RECORDING_FRAME_RATES)

export const browserPreviewInitialControlsSchema: Schema.Schema<BrowserPreviewInitialControls> =
  Schema.Struct({
    zoomFactor: browserPreviewInitialZoomFactorSchema,
    appearance: browserPreviewAppearanceSchema,
    viewport: browserPreviewViewportSchema,
  })

const recordingMimeTypeSchema = Schema.Literal(...BROWSER_PREVIEW_RECORDING_MIME_TYPES)

const finiteNumberSchema = Schema.Number.pipe(Schema.finite())
const MAX_ANNOTATION_COORDINATE = 16_384
const MAX_SOURCE_POSITION = 10_000_000
const MAX_STROKE_WIDTH = 24
const MAX_COLOR_LENGTH = 64
const MAX_PICK_TIMESTAMP_LENGTH = 64
const MAX_STYLE_CHANGES =
  BROWSER_PREVIEW_CAPTURE_LIMITS.PICK_ELEMENTS * BROWSER_PREVIEW_ANNOTATION_STYLE_PROPERTIES.length
const targetIdSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(BROWSER_PREVIEW_CAPTURE_LIMITS.PICK_TARGET_ID_LENGTH),
)
const annotationCoordinateSchema = finiteNumberSchema.pipe(
  Schema.greaterThanOrEqualTo(0),
  Schema.lessThanOrEqualTo(MAX_ANNOTATION_COORDINATE),
)
const browserPreviewElementRectSchema = Schema.Struct({
  x: annotationCoordinateSchema,
  y: annotationCoordinateSchema,
  width: annotationCoordinateSchema.pipe(Schema.greaterThan(0)),
  height: annotationCoordinateSchema.pipe(Schema.greaterThan(0)),
})

const nullableSourcePositionSchema = Schema.NullOr(
  Schema.Number.pipe(
    Schema.int(),
    Schema.greaterThan(0),
    Schema.lessThanOrEqualTo(MAX_SOURCE_POSITION),
  ),
)
const browserPreviewElementStackFrameSchema = Schema.Struct({
  functionName: Schema.NullOr(
    Schema.String.pipe(Schema.maxLength(BROWSER_PREVIEW_CAPTURE_LIMITS.PICK_COMPONENT_LENGTH)),
  ),
  fileName: Schema.NullOr(
    Schema.String.pipe(Schema.maxLength(BROWSER_PREVIEW_CAPTURE_LIMITS.PICK_SOURCE_LENGTH)),
  ),
  lineNumber: nullableSourcePositionSchema,
  columnNumber: nullableSourcePositionSchema,
})
const browserPreviewElementContextSchema = Schema.Struct({
  selector: Schema.String.pipe(
    Schema.minLength(1),
    Schema.maxLength(BROWSER_PREVIEW_CAPTURE_LIMITS.PICK_SELECTOR_LENGTH),
  ),
  tagName: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(MAX_ELEMENT_TAG_LENGTH)),
  id: Schema.NullOr(Schema.String.pipe(Schema.maxLength(MAX_ELEMENT_ID_LENGTH))),
  classes: Schema.Array(Schema.String.pipe(Schema.maxLength(MAX_ELEMENT_CLASS_LENGTH))).pipe(
    Schema.maxItems(BROWSER_PREVIEW_CAPTURE_LIMITS.PICK_CLASSES),
  ),
  role: Schema.NullOr(Schema.String.pipe(Schema.maxLength(MAX_ELEMENT_ROLE_LENGTH))),
  accessibleName: Schema.NullOr(
    Schema.String.pipe(Schema.maxLength(BROWSER_PREVIEW_CAPTURE_LIMITS.PICK_TEXT_LENGTH)),
  ),
  text: Schema.String.pipe(Schema.maxLength(BROWSER_PREVIEW_CAPTURE_LIMITS.PICK_TEXT_LENGTH)),
  rect: browserPreviewElementRectSchema,
  htmlPreview: Schema.String.pipe(
    Schema.maxLength(BROWSER_PREVIEW_CAPTURE_LIMITS.PICK_HTML_LENGTH),
  ),
  componentName: Schema.NullOr(
    Schema.String.pipe(Schema.maxLength(BROWSER_PREVIEW_CAPTURE_LIMITS.PICK_COMPONENT_LENGTH)),
  ),
  source: Schema.NullOr(browserPreviewElementStackFrameSchema),
  stack: Schema.Array(browserPreviewElementStackFrameSchema).pipe(
    Schema.maxItems(BROWSER_PREVIEW_CAPTURE_LIMITS.PICK_STACK_FRAMES),
  ),
  styles: Schema.String.pipe(Schema.maxLength(BROWSER_PREVIEW_CAPTURE_LIMITS.PICK_STYLES_LENGTH)),
  pickedAt: Schema.String.pipe(Schema.maxLength(MAX_PICK_TIMESTAMP_LENGTH)),
})
const browserPreviewAnnotationElementTargetSchema = Schema.Struct({
  id: targetIdSchema,
  element: browserPreviewElementContextSchema,
  rect: browserPreviewElementRectSchema,
})
const browserPreviewAnnotationRegionTargetSchema = Schema.Struct({
  id: targetIdSchema,
  rect: browserPreviewElementRectSchema,
})
const browserPreviewAnnotationPointSchema = Schema.Struct({
  x: annotationCoordinateSchema,
  y: annotationCoordinateSchema,
})
const browserPreviewAnnotationStrokeTargetSchema = Schema.Struct({
  id: targetIdSchema,
  color: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(MAX_COLOR_LENGTH)),
  width: finiteNumberSchema.pipe(Schema.greaterThan(0), Schema.lessThanOrEqualTo(MAX_STROKE_WIDTH)),
  points: Schema.Array(browserPreviewAnnotationPointSchema).pipe(
    Schema.minItems(BROWSER_PREVIEW_CAPTURE_LIMITS.PICK_STROKE_MIN_POINTS),
    Schema.maxItems(BROWSER_PREVIEW_CAPTURE_LIMITS.PICK_STROKE_POINTS),
  ),
  bounds: browserPreviewElementRectSchema,
})
const browserPreviewAnnotationStyleChangeSchema: Schema.Schema<BrowserPreviewAnnotationStyleChange> =
  Schema.Struct({
    targetId: targetIdSchema,
    selector: Schema.String.pipe(
      Schema.minLength(1),
      Schema.maxLength(BROWSER_PREVIEW_CAPTURE_LIMITS.PICK_SELECTOR_LENGTH),
    ),
    property: Schema.Literal(...BROWSER_PREVIEW_ANNOTATION_STYLE_PROPERTIES),
    previousValue: Schema.String.pipe(
      Schema.maxLength(BROWSER_PREVIEW_CAPTURE_LIMITS.PICK_STYLE_VALUE_LENGTH),
    ),
    value: Schema.String.pipe(
      Schema.minLength(1),
      Schema.maxLength(BROWSER_PREVIEW_CAPTURE_LIMITS.PICK_STYLE_VALUE_LENGTH),
    ),
  })

export const browserPreviewElementPickPayloadSchema: Schema.Schema<BrowserPreviewElementPickPayload> =
  Schema.Struct({
    version: Schema.Literal(BROWSER_PREVIEW_ANNOTATION_VERSION),
    pageUrl: Schema.String.pipe(Schema.maxLength(MAX_PAGE_URL_LENGTH)),
    pageTitle: Schema.String.pipe(Schema.maxLength(MAX_PAGE_TITLE_LENGTH)),
    comment: Schema.String.pipe(Schema.maxLength(BROWSER_PREVIEW_CAPTURE_LIMITS.PICK_TEXT_LENGTH)),
    elements: Schema.Array(browserPreviewAnnotationElementTargetSchema).pipe(
      Schema.maxItems(BROWSER_PREVIEW_CAPTURE_LIMITS.PICK_ELEMENTS),
    ),
    regions: Schema.Array(browserPreviewAnnotationRegionTargetSchema).pipe(
      Schema.maxItems(BROWSER_PREVIEW_CAPTURE_LIMITS.PICK_REGIONS),
    ),
    strokes: Schema.Array(browserPreviewAnnotationStrokeTargetSchema).pipe(
      Schema.maxItems(BROWSER_PREVIEW_CAPTURE_LIMITS.PICK_STROKES),
    ),
    styleChanges: Schema.Array(browserPreviewAnnotationStyleChangeSchema).pipe(
      Schema.maxItems(MAX_STYLE_CHANGES),
    ),
    captureRect: browserPreviewElementRectSchema,
  }).pipe(
    Schema.filter(
      ({ elements, regions, strokes }) =>
        elements.length + regions.length + strokes.length > 0 ||
        'An annotation must include at least one element, region, or drawing.',
    ),
    Schema.filter((payload) => {
      try {
        return (
          new TextEncoder().encode(JSON.stringify(payload)).byteLength <=
            BROWSER_PREVIEW_CAPTURE_LIMITS.PICK_TOTAL_BYTES ||
          `Annotation payload must not exceed ${String(BROWSER_PREVIEW_CAPTURE_LIMITS.PICK_TOTAL_BYTES)} bytes.`
        )
      } catch {
        return 'Annotation payload could not be serialized.'
      }
    }),
  )

export const browserPreviewRecordingSaveInputSchema: Schema.Schema<BrowserPreviewRecordingSaveInput> =
  Schema.Struct({
    previewId: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(MAX_PREVIEW_ID_LENGTH)),
    mimeType: recordingMimeTypeSchema,
    data: Schema.Uint8ArrayFromSelf.pipe(
      Schema.filter(
        (value) =>
          value.byteLength > 0 &&
          (value.byteLength <= BROWSER_PREVIEW_CAPTURE_LIMITS.RECORDING_BYTES ||
            `Recording must not exceed ${String(BROWSER_PREVIEW_CAPTURE_LIMITS.RECORDING_BYTES)} bytes.`),
      ),
    ),
    durationMs: Schema.Number.pipe(
      Schema.int(),
      Schema.greaterThan(0),
      Schema.lessThanOrEqualTo(BROWSER_PREVIEW_CAPTURE_LIMITS.RECORDING_DURATION_MS),
    ),
  })
