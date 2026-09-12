import { Schema } from '@shared/schema'
import { BROWSER_PREVIEW_AUTOMATION_LIMITS as LIMITS } from '@shared/types/browser-preview-automation'
import { BROWSER_PREVIEW_CAPTURE_LIMITS } from '@shared/types/browser-preview-controls'
import {
  browserPreviewAppearanceSchema,
  browserPreviewViewportSchema,
} from './browser-preview-controls'
import { sessionInputIdSchema } from './session-input'
import { jsonValueSchema } from './validation'

const MAX_TEXT_LENGTH = 64_000
const MAX_JSON_RESULT_BYTES = LIMITS.RESULT_BYTES
const MAX_ACCESSIBILITY_TREE_BYTES = 8 * 1024 * 1024
const BASE64_INPUT_BYTES = 3
const BASE64_OUTPUT_CHARACTERS = 4
const MAX_BASE64_LENGTH =
  Math.ceil(BROWSER_PREVIEW_CAPTURE_LIMITS.SCREENSHOT_BYTES / BASE64_INPUT_BYTES) *
  BASE64_OUTPUT_CHARACTERS
const textSchema = Schema.String.pipe(Schema.maxLength(MAX_TEXT_LENGTH))
const finiteSchema = Schema.Number.pipe(Schema.finite())
const positiveIntegerSchema = finiteSchema.pipe(
  Schema.int(),
  Schema.positive(),
  Schema.lessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
)

export const desktopBrowserStatusSchema = Schema.Struct({
  available: Schema.Boolean,
  visible: Schema.Boolean,
  tabId: Schema.NullOr(sessionInputIdSchema),
  url: Schema.NullOr(textSchema),
  title: Schema.NullOr(textSchema),
  loading: Schema.Boolean,
  viewport: Schema.NullOr(browserPreviewViewportSchema),
  appearance: Schema.NullOr(browserPreviewAppearanceSchema),
})
function boundedJsonSchema(maxBytes: number) {
  return jsonValueSchema.pipe(
    Schema.filter((value) => {
      let finite = true
      const encoded = JSON.stringify(value, (_key, entry: unknown) => {
        if (typeof entry === 'number' && !Number.isFinite(entry)) finite = false
        return entry
      })
      return finite && new TextEncoder().encode(encoded).byteLength <= maxBytes
    }),
  )
}
export const desktopBrowserJsonValueSchema = boundedJsonSchema(MAX_JSON_RESULT_BYTES)
const elementSchema = Schema.Struct({
  tag: textSchema,
  role: Schema.NullOr(textSchema),
  name: textSchema,
  selector: textSchema,
  x: finiteSchema,
  y: finiteSchema,
  width: finiteSchema,
  height: finiteSchema,
})
const consoleSchema = Schema.Struct({
  level: textSchema,
  text: textSchema,
  timestamp: textSchema,
  source: Schema.optional(textSchema),
})
const networkSchema = Schema.Struct({
  url: textSchema,
  method: textSchema,
  status: Schema.NullOr(finiteSchema),
  failed: Schema.Boolean,
  errorText: Schema.optional(textSchema),
  timestamp: textSchema,
})
const actionSchema = Schema.Struct({
  id: textSchema,
  action: textSchema,
  status: Schema.Literal('running', 'succeeded', 'failed', 'interrupted'),
  startedAt: textSchema,
  completedAt: Schema.optional(textSchema),
  error: Schema.optional(textSchema),
})
const screenshotSchema = Schema.Struct({
  mimeType: Schema.Literal('image/png'),
  data: Schema.String.pipe(
    Schema.minLength(BASE64_OUTPUT_CHARACTERS),
    Schema.maxLength(MAX_BASE64_LENGTH),
    Schema.pattern(/^[A-Za-z0-9+/]*={0,2}$/),
    Schema.filter((value) => value.length % BASE64_OUTPUT_CHARACTERS === 0),
  ),
  width: positiveIntegerSchema,
  height: positiveIntegerSchema,
}).pipe(
  Schema.filter(
    ({ width, height }) => width * height <= BROWSER_PREVIEW_CAPTURE_LIMITS.SCREENSHOT_PIXELS,
  ),
)
export const desktopBrowserSnapshotSchema = Schema.Struct({
  url: textSchema,
  title: textSchema,
  loading: Schema.Boolean,
  visibleText: Schema.String.pipe(Schema.maxLength(LIMITS.VISIBLE_TEXT_LENGTH)),
  interactiveElements: Schema.Array(elementSchema).pipe(
    Schema.maxItems(LIMITS.INTERACTIVE_ELEMENTS),
  ),
  accessibilityTree: boundedJsonSchema(MAX_ACCESSIBILITY_TREE_BYTES),
  consoleEntries: Schema.Array(consoleSchema).pipe(Schema.maxItems(LIMITS.CONSOLE_ENTRIES)),
  networkEntries: Schema.Array(networkSchema).pipe(Schema.maxItems(LIMITS.NETWORK_ENTRIES)),
  actionTimeline: Schema.Array(actionSchema).pipe(Schema.maxItems(LIMITS.ACTION_EVENTS)),
  screenshot: screenshotSchema,
})
