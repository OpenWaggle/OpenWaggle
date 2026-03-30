/**
 * Domain-owned continuation message types.
 *
 * These mirror TanStack AI's ModelMessage and UIMessage shapes
 * but are owned by the domain — no vendor imports. The TanStack adapter
 * layer maps between these and the vendor types.
 *
 * Continuation messages preserve the in-memory chat snapshot for
 * continuation flows (e.g. tool approvals) where the client must
 * carry forward UI tool state across runs.
 */

// ─── Content parts for ModelMessage-shaped continuations ─────

export interface DomainContentPartText {
  readonly type: 'text'
  readonly text: string
}

export interface DomainContentPartImage {
  readonly type: 'image_url'
  readonly image_url: { readonly url: string }
}

export type DomainContentPart = DomainContentPartText | DomainContentPartImage

// ─── Tool call (ModelMessage format) ─────────────────────────

export interface DomainToolCall {
  readonly id: string
  readonly type: 'function'
  readonly function: {
    readonly name: string
    readonly arguments: string
  }
}

// ─── ModelMessage-shaped continuation ────────────────────────

export interface DomainModelContinuationMessage {
  readonly role: 'user' | 'assistant' | 'tool'
  readonly content: string | null | readonly DomainContentPart[]
  readonly name?: string
  readonly toolCalls?: readonly DomainToolCall[]
  readonly toolCallId?: string
}

// ─── UIMessage-shaped continuation parts ─────────────────────

export type DomainToolCallState = string

export interface DomainUiTextPart {
  readonly type: 'text'
  readonly content: string
  readonly metadata?: unknown
}

export interface DomainUiToolCallPart {
  readonly type: 'tool-call'
  readonly id: string
  readonly name: string
  readonly arguments: string
  readonly state: DomainToolCallState
  readonly approval?: {
    readonly id: string
    readonly needsApproval: boolean
    readonly approved?: boolean
  }
  readonly output?: unknown
}

export interface DomainUiToolResultPart {
  readonly type: 'tool-result'
  readonly toolCallId: string
  readonly content: string
  readonly state: string
  readonly error?: string
}

export interface DomainUiThinkingPart {
  readonly type: 'thinking'
  readonly content: string
}

export type DomainUiMessagePart =
  | DomainUiTextPart
  | DomainUiToolCallPart
  | DomainUiToolResultPart
  | DomainUiThinkingPart

// ─── UIMessage-shaped continuation ───────────────────────────

export interface DomainUiContinuationMessage {
  readonly id: string
  readonly role: 'system' | 'user' | 'assistant'
  readonly parts: readonly DomainUiMessagePart[]
  readonly createdAt?: Date
}

// ─── Union ───────────────────────────────────────────────────

/**
 * A continuation message in either ModelMessage or UIMessage format.
 * The two shapes are discriminated by the presence of `parts`
 * (UIMessage-shaped) vs `content` (ModelMessage-shaped).
 */
export type DomainContinuationMessage = DomainModelContinuationMessage | DomainUiContinuationMessage
