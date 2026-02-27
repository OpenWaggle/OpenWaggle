import type { ToolCallId } from './brand'
import type { JsonObject } from './json'

export interface ToolCallRequest {
  readonly id: ToolCallId
  readonly name: string
  readonly args: Readonly<JsonObject>
}

export interface ToolCallResult {
  readonly id: ToolCallId
  readonly name: string
  readonly args: Readonly<JsonObject>
  readonly result: string
  readonly isError: boolean
  /** Duration in ms */
  readonly duration: number
}
