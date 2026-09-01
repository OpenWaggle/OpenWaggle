import type { MessageId } from './brand'
import type { SupportedModelId } from './llm'
import type { ThinkingLevel } from './settings'
import type { ToolCallRequest, ToolCallResult } from './tools'
import type { WaggleInvocation, WaggleInvocationMetadata, WaggleMessageMetadata } from './waggle'

export type MessageRole = 'user' | 'assistant' | 'system'

/**
 * Message parts — discriminated union.
 * Use `part.type` to narrow in switch/if statements.
 */
export interface TextPart {
  readonly type: 'text'
  readonly text: string
}

export type AttachmentKind = 'text' | 'image' | 'pdf'
export type AttachmentOrigin = 'user-file' | 'auto-paste-text'

export interface AttachmentRecord {
  readonly id: string
  readonly kind: AttachmentKind
  readonly origin?: AttachmentOrigin
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
export type PreparedAttachment = AttachmentRecord

/** Main-process runtime attachment shape with hydrated binary source. */
export interface HydratedAttachment extends AttachmentRecord, AttachmentSource {}

export interface HydratedAgentSendPayload extends Omit<AgentSendPayload, 'attachments'> {
  readonly attachments: readonly HydratedAttachment[]
}

export interface AgentSendPayload {
  readonly text: string
  readonly thinkingLevel: ThinkingLevel
  readonly attachments: readonly PreparedAttachment[]
  readonly waggle?: WaggleInvocation
}

export interface CompactionSummaryMetadata {
  readonly summary: string
  readonly tokensBefore: number
  readonly reason?: 'manual' | 'threshold' | 'overflow'
}

export interface BranchSummaryMetadata {
  readonly summary: string
}

export interface MessageMetadata {
  readonly waggle?: WaggleMessageMetadata
  readonly waggleInvocation?: WaggleInvocationMetadata
  readonly branchSummary?: BranchSummaryMetadata
  readonly compactionSummary?: CompactionSummaryMetadata
}

export interface Message {
  readonly id: MessageId
  readonly role: MessageRole
  readonly parts: readonly MessagePart[]
  readonly model?: SupportedModelId
  readonly metadata?: MessageMetadata
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
  return message.parts.reduce((text, part) => (isTextPart(part) ? text + part.text : text), '')
}

/**
 * What became of a send, as reported back to the caller of `agent:send-message`.
 *
 * The invoke used to return nothing, and main recovers every run failure into a value rather than failing the
 * Effect - so a caller awaiting the invoke could not tell a completed turn from a refused one. A review
 * submitted as a session's first message was therefore cleared on a failure that looked exactly like success.
 *
 * Three outcomes, not two, because "not delivered" and "cannot tell" call for different behaviour:
 *
 * - `delivered`: the run produced a turn.
 * - `refused`: the run never started, and the reason is known. A caller may treat this as an error.
 * - `cancelled`: the run was aborted. This says nothing about whether the message arrived - a cancellation
 *   before the prompt was sent reports the same outcome as one mid-turn - so it must not be raised as an
 *   error, while a caller holding work the user might still want should keep it.
 */
export type AgentSendOutcome = 'delivered' | 'refused' | 'cancelled'

export interface AgentSendReport {
  readonly outcome: AgentSendOutcome
  readonly message?: string
  readonly code?: string
}
