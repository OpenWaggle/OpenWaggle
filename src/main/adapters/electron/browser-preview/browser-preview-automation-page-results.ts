import { matchBy } from '@diegogbrisa/ts-match'
import { Schema, safeDecodeUnknown } from '@shared/schema'

const MAX_ACCESSIBILITY_NODES = 512

const interactiveElementSchema = Schema.Struct({
  tag: Schema.String,
  role: Schema.NullOr(Schema.String),
  name: Schema.String,
  selector: Schema.String,
  x: Schema.Number,
  y: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
})

const pageSnapshotSchema = Schema.Struct({
  url: Schema.String,
  title: Schema.String,
  loading: Schema.Boolean,
  visibleText: Schema.String,
  interactiveElements: Schema.Array(interactiveElementSchema),
})

const actionOutcomeSchema = Schema.Union(
  Schema.Struct({ kind: Schema.Literal('ok') }),
  Schema.Struct({ kind: Schema.Literal('not-found') }),
  Schema.Struct({ kind: Schema.Literal('not-editable') }),
  Schema.Struct({ kind: Schema.Literal('invalid-selector'), message: Schema.String }),
)

const pointOutcomeSchema = Schema.Union(
  Schema.Struct({ kind: Schema.Literal('point'), x: Schema.Number, y: Schema.Number }),
  Schema.Struct({ kind: Schema.Literal('not-found') }),
  Schema.Struct({ kind: Schema.Literal('invalid-selector'), message: Schema.String }),
)

const waitOutcomeSchema = Schema.Union(
  Schema.Struct({ kind: Schema.Literal('match'), matched: Schema.Boolean }),
  Schema.Struct({ kind: Schema.Literal('invalid-selector'), message: Schema.String }),
)

const viewportSchema = Schema.Struct({ width: Schema.Number, height: Schema.Number })

function decodeOrThrow<A, I>(schema: Schema.Schema<A, I>, value: unknown, description: string) {
  const decoded = safeDecodeUnknown(schema, value)
  if (!decoded.success) throw new Error(`Browser preview returned malformed ${description}.`)
  return decoded.data
}

export function decodeBrowserPreviewPageSnapshot(value: unknown) {
  return decodeOrThrow(pageSnapshotSchema, value, 'page snapshot data')
}

export function decodeBrowserPreviewViewport(value: unknown) {
  return decodeOrThrow(viewportSchema, value, 'viewport data')
}

export function decodeBrowserPreviewClickPoint(value: unknown) {
  const outcome = decodeBrowserPreviewClickPointOutcome(value)
  return matchBy(outcome, 'kind')
    .with('point', ({ x, y }) => ({ x, y }))
    .with('not-found', () => {
      throw new Error('Browser preview target was not found or was not actionable.')
    })
    .with('invalid-selector', ({ message }) => {
      throw new Error(`Browser preview locator was invalid: ${message}`)
    })
    .exhaustive()
}

export function decodeBrowserPreviewClickPointOutcome(value: unknown) {
  return decodeOrThrow(pointOutcomeSchema, value, 'click target data')
}

export function assertBrowserPreviewActionOutcome(value: unknown) {
  const outcome = decodeBrowserPreviewActionOutcome(value)
  return matchBy(outcome, 'kind')
    .with('ok', () => undefined)
    .with('not-found', () => {
      throw new Error('Browser preview target was not found.')
    })
    .with('not-editable', () => {
      throw new Error('Browser preview target is not editable.')
    })
    .with('invalid-selector', ({ message }) => {
      throw new Error(`Browser preview locator was invalid: ${message}`)
    })
    .exhaustive()
}

export function decodeBrowserPreviewActionOutcome(value: unknown) {
  return decodeOrThrow(actionOutcomeSchema, value, 'page action data')
}

export function decodeBrowserPreviewWaitMatch(value: unknown) {
  const outcome = decodeOrThrow(waitOutcomeSchema, value, 'wait condition data')
  return matchBy(outcome, 'kind')
    .with('match', ({ matched }) => matched)
    .with('invalid-selector', ({ message }) => {
      throw new Error(`Browser preview locator was invalid: ${message}`)
    })
    .exhaustive()
}

export function boundedBrowserPreviewAccessibilityTree(value: unknown) {
  if (typeof value !== 'object' || value === null) return value
  const nodes: unknown = Reflect.get(value, 'nodes')
  if (!Array.isArray(nodes)) return value
  return {
    nodes: nodes.slice(0, MAX_ACCESSIBILITY_NODES),
    truncated: nodes.length > MAX_ACCESSIBILITY_NODES,
  }
}
