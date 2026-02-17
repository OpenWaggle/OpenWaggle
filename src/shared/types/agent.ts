import type { MessageId } from './brand'
import type { SupportedModelId } from './llm'
import type { ToolCallRequest, ToolCallResult } from './tools'

export type MessageRole = 'user' | 'assistant'

/**
 * Message parts — discriminated union.
 * Use `part.type` to narrow in switch/if statements.
 */
export interface TextPart {
  readonly type: 'text'
  readonly text: string
}

export interface ToolCallPart {
  readonly type: 'tool-call'
  readonly toolCall: ToolCallRequest
}

export interface ToolResultPart {
  readonly type: 'tool-result'
  readonly toolResult: ToolCallResult
}

export type MessagePart = TextPart | ToolCallPart | ToolResultPart

export interface Message {
  readonly id: MessageId
  readonly role: MessageRole
  readonly parts: readonly MessagePart[]
  readonly model?: SupportedModelId
  readonly createdAt: number
}

/**
 * Agent stream events — discriminated union.
 * Streamed from main → renderer during agent execution.
 */
export type AgentStreamEvent =
  | { readonly type: 'text-delta'; readonly delta: string }
  | { readonly type: 'tool-call-start'; readonly toolCall: ToolCallRequest }
  | { readonly type: 'tool-call-result'; readonly toolResult: ToolCallResult }
  | { readonly type: 'finish'; readonly message: Message }
  | { readonly type: 'error'; readonly error: string }

export const AGENT_STATUSES = ['idle', 'streaming', 'tool-executing', 'error'] as const
export type AgentStatus = (typeof AGENT_STATUSES)[number]

/** Type-safe extraction helpers */
export function isTextPart(part: MessagePart): part is TextPart {
  return part.type === 'text'
}

export function isToolCallPart(part: MessagePart): part is ToolCallPart {
  return part.type === 'tool-call'
}

export function isToolResultPart(part: MessagePart): part is ToolResultPart {
  return part.type === 'tool-result'
}

export function getMessageText(message: Message): string {
  return message.parts
    .filter(isTextPart)
    .map((p) => p.text)
    .join('')
}
