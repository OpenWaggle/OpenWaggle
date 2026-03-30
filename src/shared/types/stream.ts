/**
 * Domain-owned stream chunk types.
 *
 * These mirror the shape of TanStack AI's StreamChunk discriminated union
 * but are owned by the domain — no vendor imports. The TanStack adapter
 * layer maps between these and the vendor types.
 */

// ─── Base fields shared by all chunk variants ────────────────

interface StreamChunkBase {
  readonly timestamp: number
  readonly model?: string
  readonly rawEvent?: unknown
}

// ─── Run lifecycle ───────────────────────────────────────────

export interface AgentRunStartedChunk extends StreamChunkBase {
  readonly type: 'RUN_STARTED'
  readonly runId: string
  readonly threadId?: string
}

export interface AgentRunFinishedChunk extends StreamChunkBase {
  readonly type: 'RUN_FINISHED'
  readonly runId: string
  readonly finishReason: 'stop' | 'length' | 'content_filter' | 'tool_calls' | null
  readonly usage?: {
    readonly promptTokens: number
    readonly completionTokens: number
    readonly totalTokens: number
  }
}

export interface AgentRunErrorChunk extends StreamChunkBase {
  readonly type: 'RUN_ERROR'
  readonly runId?: string
  readonly error: {
    readonly message: string
    readonly code?: string
    readonly name?: string
    readonly stack?: string
  }
}

// ─── Text message ────────────────────────────────────────────

export interface AgentTextMessageStartChunk extends StreamChunkBase {
  readonly type: 'TEXT_MESSAGE_START'
  readonly messageId: string
  readonly role: 'user' | 'assistant' | 'system' | 'tool'
}

export interface AgentTextMessageContentChunk extends StreamChunkBase {
  readonly type: 'TEXT_MESSAGE_CONTENT'
  readonly messageId: string
  readonly delta: string
  readonly content?: string
}

export interface AgentTextMessageEndChunk extends StreamChunkBase {
  readonly type: 'TEXT_MESSAGE_END'
  readonly messageId: string
}

// ─── Tool calls ──────────────────────────────────────────────

export interface AgentToolCallStartChunk extends StreamChunkBase {
  readonly type: 'TOOL_CALL_START'
  readonly toolCallId: string
  readonly toolName: string
  readonly parentMessageId?: string
  readonly index?: number
}

export interface AgentToolCallArgsChunk extends StreamChunkBase {
  readonly type: 'TOOL_CALL_ARGS'
  readonly toolCallId: string
  readonly delta: string
  readonly args?: string
}

export interface AgentToolCallEndChunk extends StreamChunkBase {
  readonly type: 'TOOL_CALL_END'
  readonly toolCallId: string
  readonly toolName: string
  readonly input?: unknown
  readonly result?: string
}

// ─── Steps (thinking / reasoning) ────────────────────────────

export interface AgentStepStartedChunk extends StreamChunkBase {
  readonly type: 'STEP_STARTED'
  readonly stepId: string
  readonly stepType?: string
}

export interface AgentStepFinishedChunk extends StreamChunkBase {
  readonly type: 'STEP_FINISHED'
  readonly stepId: string
  readonly delta: string
  readonly content?: string
}

// ─── Snapshots and state ─────────────────────────────────────

export interface AgentMessagesSnapshotChunk extends StreamChunkBase {
  readonly type: 'MESSAGES_SNAPSHOT'
  readonly messages: readonly unknown[]
}

export interface AgentStateSnapshotChunk extends StreamChunkBase {
  readonly type: 'STATE_SNAPSHOT'
  readonly state: Readonly<Record<string, unknown>>
}

export interface AgentStateDeltaChunk extends StreamChunkBase {
  readonly type: 'STATE_DELTA'
  readonly delta: Readonly<Record<string, unknown>>
}

// ─── Custom events ───────────────────────────────────────────

export interface AgentCustomChunk extends StreamChunkBase {
  readonly type: 'CUSTOM'
  readonly name: string
  readonly value?: unknown
}

// ─── Union ───────────────────────────────────────────────────

export type AgentStreamChunk =
  | AgentRunStartedChunk
  | AgentRunFinishedChunk
  | AgentRunErrorChunk
  | AgentTextMessageStartChunk
  | AgentTextMessageContentChunk
  | AgentTextMessageEndChunk
  | AgentToolCallStartChunk
  | AgentToolCallArgsChunk
  | AgentToolCallEndChunk
  | AgentStepStartedChunk
  | AgentStepFinishedChunk
  | AgentMessagesSnapshotChunk
  | AgentStateSnapshotChunk
  | AgentStateDeltaChunk
  | AgentCustomChunk
