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
const timeoutSchema = Schema.optionalWith(
  positiveIntegerSchema.pipe(Schema.lessThanOrEqualTo(LIMITS.MAX_TIMEOUT_MS)),
  { exact: true },
)
const targetFields = { tabId: Schema.optionalWith(sessionInputIdSchema, { exact: true }) }
const selectorFields = {
  selector: Schema.optionalWith(nonemptyTextSchema, { exact: true }),
  locator: Schema.optionalWith(nonemptyTextSchema, { exact: true }),
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
    protocol: Schema.optionalWith(Schema.Literal('http', 'https'), { exact: true }),
    path: Schema.optionalWith(Schema.String.pipe(Schema.maxLength(MAX_URL_LENGTH)), {
      exact: true,
    }),
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
    orientation: Schema.optionalWith(Schema.Literal('portrait', 'landscape'), { exact: true }),
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
      url: Schema.optionalWith(urlSchema, { exact: true }),
      open: Schema.optionalWith(Schema.Boolean, { exact: true }),
      reuseExistingTab: Schema.optionalWith(Schema.Boolean, { exact: true }),
    }),
  ),
  command(
    'navigate',
    Schema.Struct({
      ...targetFields,
      url: Schema.optionalWith(urlSchema, { exact: true }),
      target: Schema.optionalWith(navigationTargetSchema, { exact: true }),
      readiness: Schema.optionalWith(Schema.Literal('load', 'domContentLoaded', 'none'), {
        exact: true,
      }),
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
      x: Schema.optionalWith(finiteSchema, { exact: true }),
      y: Schema.optionalWith(finiteSchema, { exact: true }),
      timeoutMs: timeoutSchema,
    }),
  ),
  command(
    'type',
    Schema.Struct({
      ...targetFields,
      ...selectorFields,
      text: textSchema,
      clear: Schema.optionalWith(Schema.Boolean, { exact: true }),
      timeoutMs: timeoutSchema,
    }),
  ),
  command(
    'press',
    Schema.Struct({
      ...targetFields,
      key: nonemptyTextSchema,
      modifiers: Schema.optionalWith(
        Schema.Array(Schema.Literal('Alt', 'Control', 'Meta', 'Shift')).pipe(
          Schema.maxItems(MAX_MODIFIERS),
        ),
        { exact: true },
      ),
    }),
  ),
  command(
    'scroll',
    Schema.Struct({
      ...targetFields,
      ...selectorFields,
      deltaX: Schema.optionalWith(finiteSchema, { exact: true }),
      deltaY: Schema.optionalWith(finiteSchema, { exact: true }),
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
      awaitPromise: Schema.optionalWith(Schema.Boolean, { exact: true }),
      returnByValue: Schema.optionalWith(Schema.Boolean, { exact: true }),
    }),
  ),
  command(
    'waitFor',
    Schema.Struct({
      ...targetFields,
      ...selectorFields,
      text: Schema.optionalWith(textSchema, { exact: true }),
      urlIncludes: Schema.optionalWith(textSchema, { exact: true }),
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
