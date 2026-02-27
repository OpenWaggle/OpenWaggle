import type { ModelMessage } from '@tanstack/ai'
import type { MessageId } from './brand'
import type { SupportedModelId } from './llm'
import type { QualityPreset } from './settings'
import type { ToolCallRequest, ToolCallResult } from './tools'
import type { WaggleMessageMetadata } from './waggle'

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

export interface ReasoningPart {
  readonly type: 'reasoning'
  readonly text: string
}

export type MessagePart = TextPart | AttachmentPart | ToolCallPart | ToolResultPart | ReasoningPart

export interface AttachmentSource {
  readonly source: {
    readonly type: 'data'
    readonly value: string
    readonly mimeType: string
  } | null
}

/** Renderer-safe attachment shape returned by `attachments:prepare` (no binary payload). */
export interface PreparedAttachment extends AttachmentRecord {}

/** Main-process runtime attachment shape with hydrated binary source. */
export interface HydratedAttachment extends AttachmentRecord, AttachmentSource {}

export interface HydratedAgentSendPayload extends Omit<AgentSendPayload, 'attachments'> {
  readonly attachments: readonly HydratedAttachment[]
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
    readonly waggle?: WaggleMessageMetadata
  }
  readonly createdAt: number
}

/** Type-safe extraction helper used by getMessageText and IPC handlers. */
export function isTextPart(part: MessagePart): part is TextPart {
  return part.type === 'text'
}

/** Used by waggle coordination to detect tool-only assistant turns. */
export function isToolCallPart(part: MessagePart): part is ToolCallPart {
  return part.type === 'tool-call'
}

export function getMessageText(message: Message): string {
  return message.parts
    .filter(isTextPart)
    .map((p) => p.text)
    .join('')
}
