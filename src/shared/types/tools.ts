import type { SchemaType } from '@shared/schema'
import type { toolCallResultSchema } from '@shared/schemas/message'
import type {
  nestedToolCallRecordSchema,
  nestedToolCallsSchema,
} from '@shared/schemas/nested-tool-calls'

/**
 * One call a tool made through Pi `ctx.executeTool()`, as Pi records it on the calling tool's
 * result. Pi keeps no result for it and gives it no transcript entry of its own.
 */
export type NestedToolCallRecord = SchemaType<typeof nestedToolCallRecordSchema>

/** Pi's bounded record of the nested calls a tool made. */
export type NestedToolCalls = SchemaType<typeof nestedToolCallsSchema>

export type ToolCallResult = SchemaType<typeof toolCallResultSchema>
