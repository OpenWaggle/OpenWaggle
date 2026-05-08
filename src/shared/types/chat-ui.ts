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

export interface ChatToolCallPart {
  readonly type: 'tool-call'
  readonly id: string
  readonly name: string
  readonly arguments: string
  readonly state: string
  readonly output?: unknown
  readonly partialOutput?: unknown
}

export interface ChatToolResultPart {
  readonly type: 'tool-result'
  readonly toolCallId: string
  readonly content: unknown
  readonly state: string
  readonly sourceMessageId?: string
  readonly error?: string
  readonly output?: unknown
}

interface ChatBinarySource {
  readonly value: string
}

export interface ChatImagePart {
  readonly type: 'image'
  readonly source: ChatBinarySource
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
}

export interface ChatBranchSummaryMetadata {
  readonly summary: string
}

export interface UIMessageMetadata {
  readonly branchSummary?: ChatBranchSummaryMetadata
  readonly compactionSummary?: ChatCompactionSummaryMetadata
}

export interface UIMessage {
  readonly id: string
  readonly role: ChatMessageRole
  readonly parts: UIMessagePart[]
  readonly createdAt?: Date
  readonly metadata?: UIMessageMetadata
}
