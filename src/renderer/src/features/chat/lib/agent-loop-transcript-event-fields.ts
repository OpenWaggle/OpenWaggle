import { Schema } from '@shared/schema'
import { lenientExactOptional } from '@shared/schemas/lenient-exact'
import { transportEventBaseFields } from '@shared/schemas/stream'
import { agentTransportErrorInfoSchema } from '@shared/schemas/stream-assistant-events'
import { jsonValueSchema } from '@shared/schemas/validation'

/**
 * The tolerant forms of the transport event fields a persisted Agent loop event holds. History can
 * come from an older or newer build, so an optional field of the wrong shape is left out rather
 * than costing the event; the decoded types are the strict schemas' own.
 */

/** `timestamp` is required; `model` and `rawEvent` are kept only when they decode. */
export const persistedTransportEventBaseFields = {
  ...transportEventBaseFields,
  model: lenientExactOptional(Schema.String),
  rawEvent: lenientExactOptional(jsonValueSchema),
}

/** An error needs its `message`; `code`, `name` and `stack` are kept only when they decode. */
export const persistedTransportErrorInfoSchema = Schema.Struct({
  ...agentTransportErrorInfoSchema.fields,
  code: lenientExactOptional(Schema.String),
  name: lenientExactOptional(Schema.String),
  stack: lenientExactOptional(Schema.String),
})
