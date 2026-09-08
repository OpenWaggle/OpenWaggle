import { Schema } from '../schema'
import { jsonValueSchema } from './validation'

const activityEventBase = {
  timestamp: Schema.Number,
  model: Schema.optional(Schema.String),
  rawEvent: Schema.optional(jsonValueSchema),
}
const compactionReason = Schema.Literal('manual', 'threshold', 'overflow')

export const backgroundRunActivityEventsSchema = Schema.Array(
  Schema.Union(
    Schema.Struct({
      ...activityEventBase,
      type: Schema.Literal('compaction_start'),
      reason: compactionReason,
    }),
    Schema.Struct({
      ...activityEventBase,
      type: Schema.Literal('compaction_end'),
      reason: compactionReason,
      result: jsonValueSchema,
      aborted: Schema.Boolean,
      willRetry: Schema.Boolean,
      errorMessage: Schema.optional(Schema.String),
    }),
    Schema.Struct({
      ...activityEventBase,
      type: Schema.Literal('auto_retry_start'),
      attempt: Schema.Number,
      maxAttempts: Schema.Number,
      delayMs: Schema.Number,
      errorMessage: Schema.String,
    }),
    Schema.Struct({
      ...activityEventBase,
      type: Schema.Literal('auto_retry_end'),
      success: Schema.Boolean,
      attempt: Schema.Number,
      finalError: Schema.optional(Schema.String),
    }),
  ),
)
