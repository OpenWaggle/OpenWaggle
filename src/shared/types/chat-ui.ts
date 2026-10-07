import type { SessionId } from './brand'
import type { WaggleInvocationMetadata } from './waggle'

export type ChatMessageRole = 'system' | 'user' | 'assistant'

export interface ChatTextPart {
  readonly type: 'text'
  readonly content: string
}

export interface ChatThinkingPart {
  readonly type: 'thinking'
  readonly content: string
  readonly stepId?: string
}

/**
 * A call another tool made through Pi `ctx.executeTool()`, for example from codemode. It has no
 * transcript entry of its own and renders under the model-issued tool call that made it, directly
 * or through another nested call.
 */
export interface ChatNestedToolCall {
  readonly id: string
  readonly name: string
  /** JSON arguments; omitted when Pi left them out of its record for size. */
  readonly arguments?: string
  /** `unfinished`: the call was still running when the calling tool finished. */
  readonly state: 'executing' | 'complete' | 'error' | 'unfinished'
  /** The live result; Pi does not keep nested results in the Session. */
  readonly output?: unknown
  readonly partialOutput?: unknown
  /** Truncated error text Pi recorded for a failed call. */
  readonly error?: string
}

export interface ChatToolCallPart {
  readonly type: 'tool-call'
  readonly id: string
  readonly name: string
  readonly arguments: string
  readonly state: string
  readonly output?: unknown
  readonly partialOutput?: unknown
  /** Nested calls seen live while this call ran. */
  readonly nestedCalls?: readonly ChatNestedToolCall[]
}

export interface ChatToolResultPart {
  readonly type: 'tool-result'
  readonly toolCallId: string
  readonly content: unknown
  readonly state: string
  readonly sourceMessageId?: string
  readonly error?: string
  readonly output?: unknown
  /** Nested calls Pi recorded on the persisted tool result. */
  readonly nestedCalls?: readonly ChatNestedToolCall[]
}

interface ChatBinarySource {
  readonly value: string
}

export interface ChatImagePart {
  readonly type: 'image'
  readonly source: ChatBinarySource
  readonly name?: string
  readonly attachmentIndex?: number
}

export interface ChatAudioPart {
  readonly type: 'audio'
  readonly source: ChatBinarySource
}

export interface ChatVideoPart {
  readonly type: 'video'
  readonly source: ChatBinarySource
}

export interface ChatDocumentPart {
  readonly type: 'document'
  readonly source: ChatBinarySource
}

export type UIMessagePart =
  | ChatTextPart
  | ChatThinkingPart
  | ChatToolCallPart
  | ChatToolResultPart
  | ChatImagePart
  | ChatAudioPart
  | ChatVideoPart
  | ChatDocumentPart

export interface ChatCompactionSummaryMetadata {
  readonly summary: string
  readonly tokensBefore: number
  readonly reason?: 'manual' | 'threshold' | 'overflow'
}

export interface ChatBranchSummaryMetadata {
  readonly summary: string
}

export interface UIMessageMetadata {
  /** Persisted Session node identity used by branch-scoped resource provenance. */
  readonly sessionNodeId?: string
  readonly sessionNodeCreatedOrder?: number
  readonly durableTextSha256?: string
  readonly visualizationSessionId?: SessionId
  readonly branchSummary?: ChatBranchSummaryMetadata
  readonly compactionSummary?: ChatCompactionSummaryMetadata
  readonly waggleInvocation?: WaggleInvocationMetadata
  readonly steerDelivery?: 'waiting-for-compaction' | 'sending'
  /**
   * A user row the Run published when it incorporated the message, before its node was persisted:
   * its id is a stream id, not a Session node id.
   */
  readonly liveIncorporated?: true
}

export interface UIMessage {
  readonly id: string
  readonly role: ChatMessageRole
  readonly parts: UIMessagePart[]
  readonly createdAt?: Date
  readonly metadata?: UIMessageMetadata
}
