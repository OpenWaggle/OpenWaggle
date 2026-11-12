import type { SchemaType } from '@shared/schema'
import type {
  nestedToolCallRecordSchema,
  nestedToolCallsSchema,
} from '@shared/schemas/nested-tool-calls'
import type { ToolCallId } from './brand'
import type { JsonObject, JsonValue } from './json'

export interface ToolCallRequest {
  readonly id: ToolCallId
  readonly name: string
  readonly args: Readonly<JsonObject>
  readonly state?: 'input-complete'
  /** Nested calls seen live while the call ran, kept in the active Run buffer for reconnects. */
  readonly nestedCalls?: NestedToolCalls
}

/**
 * One call a tool made through Pi `ctx.executeTool()`, as Pi records it on the calling tool's
 * result. Pi keeps no result for it and gives it no transcript entry of its own.
 */
export type NestedToolCallRecord = SchemaType<typeof nestedToolCallRecordSchema>

/** Pi's bounded record of the nested calls a tool made. */
export type NestedToolCalls = SchemaType<typeof nestedToolCallsSchema>

export interface ToolCallResult {
  readonly id: ToolCallId
  readonly name: string
  readonly args: Readonly<JsonObject>
  readonly result: JsonValue
  readonly isError: boolean
  /** Duration in ms */
  readonly duration: number
  readonly details?: JsonValue
  readonly nestedCalls?: NestedToolCalls
}
