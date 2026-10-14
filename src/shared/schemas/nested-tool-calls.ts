import { Schema } from '@shared/schema'
import { jsonObjectSchema } from './validation'

/** One call a tool made through Pi `ctx.executeTool()`, as `NestedToolCallRecord` describes it. */
const nestedToolCallRecordSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  args: Schema.optional(jsonObjectSchema),
  argsBytes: Schema.optional(Schema.Number),
  status: Schema.Literal('ok', 'error', 'unfinished'),
  durationMs: Schema.optional(Schema.Number),
  error: Schema.optional(Schema.String),
})

/**
 * The bounded record of a tool's nested calls (`NestedToolCalls`), as the active Run buffer keeps
 * it on a tool call or tool result and the Session Host sends it in Run snapshots.
 */
export const nestedToolCallsSchema = Schema.Struct({
  calls: Schema.Array(nestedToolCallRecordSchema),
  complete: Schema.Boolean,
  droppedCalls: Schema.optional(Schema.Number),
})
