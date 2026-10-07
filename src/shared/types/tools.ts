import type { ToolCallId } from './brand'
import type { JsonObject, JsonValue } from './json'

export interface ToolCallRequest {
  readonly id: ToolCallId
  readonly name: string
  readonly args: Readonly<JsonObject>
  readonly state?: 'input-complete'
}

/**
 * One call a tool made through Pi `ctx.executeTool()`, as Pi records it on the calling tool's
 * result. Pi keeps no result for it and gives it no transcript entry of its own.
 */
export interface NestedToolCallRecord {
  readonly id: string
  readonly name: string
  /** Omitted when over Pi's size limits; `argsBytes` then gives their size. */
  readonly args?: Readonly<JsonObject>
  readonly argsBytes?: number
  /** `unfinished`: the call was still running when the calling tool finished. */
  readonly status: 'ok' | 'error' | 'unfinished'
  readonly durationMs?: number
  /** Error text, truncated by Pi. */
  readonly error?: string
}

/** Pi's bounded record of the nested calls a tool made. */
export interface NestedToolCalls {
  readonly calls: readonly NestedToolCallRecord[]
  /** False when Pi dropped calls, omitted arguments, or calls had not finished. */
  readonly complete: boolean
}

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
