import {
  BROWSER_PREVIEW_VIEWPORT_MAX_AREA,
  BROWSER_PREVIEW_VIEWPORT_MAX_DIMENSION,
  BROWSER_PREVIEW_VIEWPORT_MIN_DIMENSION,
} from '@shared/browser-preview-viewports'
import { decodeUnknownExactOrThrow, Schema } from '@shared/schema'
import { SessionId } from '@shared/types/brand'
import { BROWSER_PREVIEW_AUTOMATION_LIMITS as LIMITS } from '@shared/types/browser-preview-automation'
import { BROWSER_PREVIEW_VIEWPORT_PRESET_IDS } from '@shared/types/browser-preview-controls'
import type {
  DesktopBrowserCommand,
  DesktopBrowserInputMap,
  DesktopBrowserOperation,
  DesktopBrowserResult,
  DesktopBrowserValueMap,
} from '@shared/types/desktop-browser-service'
import {
  browserPreviewAppearanceSchema,
  browserPreviewViewportSchema,
} from './browser-preview-controls'
import {
  desktopBrowserJsonValueSchema,
  desktopBrowserSnapshotSchema,
  desktopBrowserStatusSchema,
} from './desktop-browser-values'
import { sessionInputIdSchema, sessionInputPathSchema } from './session-input'

const MAX_URL_LENGTH = 8_192
const MAX_TCP_PORT = 65_535
const MAX_TEXT_LENGTH = 64_000
const MAX_MODIFIERS = 4
const textSchema = Schema.String.pipe(Schema.maxLength(MAX_TEXT_LENGTH))
const nonemptyTextSchema = textSchema.pipe(Schema.minLength(1))
const urlSchema = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(MAX_URL_LENGTH))
const finiteSchema = Schema.Number.pipe(Schema.finite())
const positiveIntegerSchema = finiteSchema.pipe(
  Schema.int(),
  Schema.positive(),
  Schema.lessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
)
const timeoutSchema = Schema.optional(
  positiveIntegerSchema.pipe(Schema.lessThanOrEqualTo(LIMITS.MAX_TIMEOUT_MS)),
)
const targetFields = { tabId: Schema.optional(sessionInputIdSchema) }
const selectorFields = {
  selector: Schema.optional(nonemptyTextSchema),
  locator: Schema.optional(nonemptyTextSchema),
}
const targetSchema = Schema.Struct(targetFields)
const scopeSchema = Schema.Struct({
  sessionId: sessionInputIdSchema.pipe(Schema.fromBrand(SessionId)),
  workingPath: sessionInputPathSchema.pipe(
    Schema.minLength(1),
    Schema.filter((value) => !value.includes('\0')),
  ),
})
const dimensionSchema = positiveIntegerSchema.pipe(
  Schema.greaterThanOrEqualTo(BROWSER_PREVIEW_VIEWPORT_MIN_DIMENSION),
  Schema.lessThanOrEqualTo(BROWSER_PREVIEW_VIEWPORT_MAX_DIMENSION),
)
const navigationTargetSchema = Schema.Union(
  Schema.Struct({ kind: Schema.Literal('url'), url: urlSchema }),
  Schema.Struct({
    kind: Schema.Literal('environment-port'),
    port: positiveIntegerSchema.pipe(Schema.lessThanOrEqualTo(MAX_TCP_PORT)),
    protocol: Schema.optional(Schema.Literal('http', 'https')),
    path: Schema.optional(Schema.String.pipe(Schema.maxLength(MAX_URL_LENGTH))),
  }),
)
const resizeSchema = Schema.Union(
  Schema.Struct({ ...targetFields, mode: Schema.Literal('fill') }),
  Schema.Struct({
    ...targetFields,
    mode: Schema.Literal('freeform'),
    width: dimensionSchema,
    height: dimensionSchema,
  }).pipe(
    Schema.filter(({ width, height }) => width * height <= BROWSER_PREVIEW_VIEWPORT_MAX_AREA),
  ),
  Schema.Struct({
    ...targetFields,
    mode: Schema.Literal('preset'),
    preset: Schema.Literal(...BROWSER_PREVIEW_VIEWPORT_PRESET_IDS),
    orientation: Schema.optional(Schema.Literal('portrait', 'landscape')),
  }),
)
function command<Operation extends DesktopBrowserOperation, Encoded>(
  operation: Operation,
  input: Schema.Schema<DesktopBrowserInputMap[Operation], Encoded>,
) {
  return Schema.Struct({
    service: Schema.Literal('browser'),
    operation: Schema.Literal(operation),
    scope: scopeSchema,
    input,
  })
}

/** Decode exactly at the reverse-RPC boundary; native services retain semantic validation. */
const desktopBrowserCommandWireSchema = Schema.Union(
  command('status', targetSchema),
  command(
    'open',
    Schema.Struct({
      ...targetFields,
      url: Schema.optional(urlSchema),
      open: Schema.optional(Schema.Boolean),
      reuseExistingTab: Schema.optional(Schema.Boolean),
    }),
  ),
  command(
    'navigate',
    Schema.Struct({
      ...targetFields,
      url: Schema.optional(urlSchema),
      target: Schema.optional(navigationTargetSchema),
      readiness: Schema.optional(Schema.Literal('load', 'domContentLoaded', 'none')),
      timeoutMs: timeoutSchema,
    }),
  ),
  command('resize', resizeSchema),
  command(
    'setAppearance',
    Schema.Struct({ ...targetFields, colorScheme: browserPreviewAppearanceSchema }),
  ),
  command('snapshot', targetSchema),
  command(
    'click',
    Schema.Struct({
      ...targetFields,
      ...selectorFields,
      x: Schema.optional(finiteSchema),
      y: Schema.optional(finiteSchema),
      timeoutMs: timeoutSchema,
    }),
  ),
  command(
    'type',
    Schema.Struct({
      ...targetFields,
      ...selectorFields,
      text: textSchema,
      clear: Schema.optional(Schema.Boolean),
      timeoutMs: timeoutSchema,
    }),
  ),
  command(
    'press',
    Schema.Struct({
      ...targetFields,
      key: nonemptyTextSchema,
      modifiers: Schema.optional(
        Schema.Array(Schema.Literal('Alt', 'Control', 'Meta', 'Shift')).pipe(
          Schema.maxItems(MAX_MODIFIERS),
        ),
      ),
    }),
  ),
  command(
    'scroll',
    Schema.Struct({
      ...targetFields,
      ...selectorFields,
      deltaX: Schema.optional(finiteSchema),
      deltaY: Schema.optional(finiteSchema),
    }),
  ),
  command(
    'evaluate',
    Schema.Struct({
      ...targetFields,
      expression: Schema.String.pipe(
        Schema.minLength(1),
        Schema.maxLength(LIMITS.EXPRESSION_LENGTH),
      ),
      awaitPromise: Schema.optional(Schema.Boolean),
      returnByValue: Schema.optional(Schema.Boolean),
    }),
  ),
  command(
    'waitFor',
    Schema.Struct({
      ...targetFields,
      ...selectorFields,
      text: Schema.optional(textSchema),
      urlIncludes: Schema.optional(textSchema),
      timeoutMs: timeoutSchema,
    }),
  ),
  command('startRecording', targetSchema),
  command('stopRecording', targetSchema),
)

function result<
  Operation extends DesktopBrowserOperation,
  Value extends DesktopBrowserValueMap[Operation],
  Encoded,
>(operation: Operation, value: Schema.Schema<Value, Encoded>) {
  return Schema.Struct({
    service: Schema.Literal('browser'),
    operation: Schema.Literal(operation),
    value,
  })
}

const desktopBrowserResultWireSchema = Schema.Union(
  result('status', desktopBrowserStatusSchema),
  result('open', desktopBrowserStatusSchema),
  result('navigate', desktopBrowserStatusSchema),
  result(
    'resize',
    Schema.Struct({ tabId: sessionInputIdSchema, viewport: browserPreviewViewportSchema }),
  ),
  result(
    'setAppearance',
    Schema.Struct({ tabId: sessionInputIdSchema, colorScheme: browserPreviewAppearanceSchema }),
  ),
  result('snapshot', desktopBrowserSnapshotSchema),
  result('click', Schema.Null),
  result('type', Schema.Null),
  result('press', Schema.Null),
  result('scroll', Schema.Null),
  result('evaluate', desktopBrowserJsonValueSchema),
  result('waitFor', Schema.Null),
  result(
    'startRecording',
    Schema.Struct({
      tabId: sessionInputIdSchema,
      recording: Schema.Boolean,
      startedAt: Schema.NullOr(textSchema),
    }),
  ),
  result(
    'stopRecording',
    Schema.Struct({
      id: sessionInputIdSchema,
      tabId: sessionInputIdSchema,
      path: sessionInputPathSchema,
      mimeType: nonemptyTextSchema,
      sizeBytes: finiteSchema.pipe(
        Schema.int(),
        Schema.nonNegative(),
        Schema.lessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
      ),
      createdAt: textSchema,
    }),
  ),
)

export const desktopBrowserCommandSchema: Schema.Schema<DesktopBrowserCommand> = Schema.typeSchema(
  desktopBrowserCommandWireSchema,
)
export const desktopBrowserResultSchema: Schema.Schema<DesktopBrowserResult> = Schema.typeSchema(
  desktopBrowserResultWireSchema,
)

export function decodeDesktopBrowserCommand(value: unknown): DesktopBrowserCommand {
  return decodeUnknownExactOrThrow(desktopBrowserCommandSchema, value)
}

export function decodeDesktopBrowserResult(value: unknown): DesktopBrowserResult {
  return decodeUnknownExactOrThrow(desktopBrowserResultSchema, value)
}
