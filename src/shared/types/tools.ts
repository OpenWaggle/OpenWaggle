import type { ToolCallId } from './brand'

/** Names of all built-in tools — extensible via the registry */
export const BUILT_IN_TOOL_NAMES = [
  'readFile',
  'writeFile',
  'editFile',
  'runCommand',
  'glob',
  'listFiles',
  'askUser',
] as const

export type BuiltInToolName = (typeof BUILT_IN_TOOL_NAMES)[number]

export interface ToolCallRequest {
  readonly id: ToolCallId
  readonly name: string
  readonly args: Readonly<Record<string, unknown>>
}

export interface ToolCallResult {
  readonly id: ToolCallId
  readonly name: string
  readonly args: Readonly<Record<string, unknown>>
  readonly result: string
  readonly isError: boolean
  /** Duration in ms */
  readonly duration: number
}

export const TOOL_APPROVAL_STATUSES = ['pending', 'approved', 'denied'] as const
export type ToolApprovalStatus = (typeof TOOL_APPROVAL_STATUSES)[number]

export interface ToolApprovalRequest {
  readonly callId: ToolCallId
  readonly name: string
  readonly args: Readonly<Record<string, unknown>>
}
