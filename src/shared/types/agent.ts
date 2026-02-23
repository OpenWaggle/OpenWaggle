import type { ModelMessage } from '@tanstack/ai'
import type { MessageId } from './brand'
import type { SupportedModelId } from './llm'
import type { QualityPreset } from './settings'
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

export type AttachmentKind = 'text' | 'image' | 'pdf'

export interface AttachmentRecord {
  readonly id: string
  readonly kind: AttachmentKind
  readonly name: string
  readonly path: string
  readonly mimeType: string
  readonly sizeBytes: number
  readonly extractedText: string
}

export interface AttachmentPart {
  readonly type: 'attachment'
  readonly attachment: AttachmentRecord
}

export interface ToolCallPart {
  readonly type: 'tool-call'
  readonly toolCall: ToolCallRequest
}

export interface ToolResultPart {
  readonly type: 'tool-result'
  readonly toolResult: ToolCallResult
}

export interface ThinkingPart {
  readonly type: 'thinking'
  readonly text: string
}

export type MessagePart = TextPart | AttachmentPart | ToolCallPart | ToolResultPart | ThinkingPart

export interface PreparedAttachment extends AttachmentRecord {
  readonly source: {
    readonly type: 'data'
    readonly value: string
    readonly mimeType: string
  } | null
}

export interface AgentSendPayload {
  readonly text: string
  readonly qualityPreset: QualityPreset
  readonly attachments: readonly PreparedAttachment[]
  /**
   * Optional in-memory chat snapshot used for continuation flows
   * (e.g. tool approvals) where the client must preserve UI tool state.
   */
  readonly continuationMessages?: readonly ModelMessage[]
}

export interface Message {
  readonly id: MessageId
  readonly role: MessageRole
  readonly parts: readonly MessagePart[]
  readonly model?: SupportedModelId
  readonly metadata?: {
    readonly orchestrationRunId?: string
    readonly usedFallback?: boolean
  }
  readonly createdAt: number
}

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

export function isAttachmentPart(part: MessagePart): part is AttachmentPart {
  return part.type === 'attachment'
}

export function isThinkingPart(part: MessagePart): part is ThinkingPart {
  return part.type === 'thinking'
}

export function getMessageText(message: Message): string {
  return message.parts
    .filter(isTextPart)
    .map((p) => p.text)
    .join('')
}
