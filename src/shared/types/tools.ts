import type { ToolCallId } from './brand'
import type { JsonObject, JsonValue } from './json'

export interface ToolCallRequest {
  readonly id: ToolCallId
  readonly name: string
  readonly args: Readonly<JsonObject>
  readonly state?: 'input-complete'
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
}
