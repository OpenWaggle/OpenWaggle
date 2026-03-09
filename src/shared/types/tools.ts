import type { ToolCallId } from './brand'
import type { JsonObject } from './json'

export interface ToolCallApprovalState {
  readonly id: string
  readonly needsApproval: boolean
  readonly approved?: boolean
}

export interface ToolCallRequest {
  readonly id: ToolCallId
  readonly name: string
  readonly args: Readonly<JsonObject>
  readonly state?: 'input-complete' | 'approval-requested' | 'approval-responded'
  readonly approval?: ToolCallApprovalState
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
