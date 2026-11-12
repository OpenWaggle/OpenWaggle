import { Schema } from '@shared/schema'
import { jsonObjectSchema } from './validation'

/** One call a tool made through Pi `ctx.executeTool()`: the source of `NestedToolCallRecord`. */
export const nestedToolCallRecordSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  /** Omitted when over Pi's size limits; `argsBytes` then gives their size. */
  args: Schema.optional(jsonObjectSchema),
  argsBytes: Schema.optional(Schema.Number),
  /** `unfinished`: the call was still running when the calling tool finished. */
  status: Schema.Literal('ok', 'error', 'unfinished'),
  durationMs: Schema.optional(Schema.Number),
  /** Error text, truncated by Pi. */
  error: Schema.optional(Schema.String),
})

/**
 * The bounded record of a tool's nested calls (`NestedToolCalls`), as the active Run buffer keeps
 * it on a tool call or tool result and the Session Host sends it in Run snapshots.
 */
export const nestedToolCallsSchema = Schema.Struct({
  calls: Schema.Array(nestedToolCallRecordSchema),
  /** False when Pi dropped calls, omitted arguments, or calls had not finished. */
  complete: Schema.Boolean,
  /**
   * Calls left out past the maximum, counted by OpenWaggle's live record. Pi's own record does
   * not count them: it is only marked incomplete.
   */
  droppedCalls: Schema.optional(Schema.Number),
})
