/**
 * OpenWaggle-owned transport events sent over IPC between main and renderer.
 *
 * These events intentionally mirror Pi session/runtime semantics closely while
 * remaining vendor-free shared types.
 */

import type { JsonValue } from './json'

interface TransportEventBase {
  readonly timestamp: number
  readonly model?: string
  readonly rawEvent?: JsonValue
}

export interface AgentTransportErrorInfo {
  readonly message: string
  readonly code?: string
  readonly name?: string
  readonly stack?: string
}

export interface AgentAssistantTextStartEvent {
  readonly type: 'text_start'
  readonly contentIndex: number
}

export interface AgentAssistantTextDeltaEvent {
  readonly type: 'text_delta'
  readonly contentIndex: number
  readonly delta: string
}

export interface AgentAssistantTextEndEvent {
  readonly type: 'text_end'
  readonly contentIndex: number
  readonly content: string
}

export interface AgentAssistantThinkingStartEvent {
  readonly type: 'thinking_start'
  readonly contentIndex: number
}

export interface AgentAssistantThinkingDeltaEvent {
  readonly type: 'thinking_delta'
  readonly contentIndex: number
  readonly delta: string
}

export interface AgentAssistantThinkingEndEvent {
  readonly type: 'thinking_end'
  readonly contentIndex: number
  readonly content: string
}

export interface AgentAssistantToolCallStartEvent {
  readonly type: 'toolcall_start'
  readonly contentIndex: number
  readonly toolCallId: string
  readonly toolName: string
  readonly input?: JsonValue
}

export interface AgentAssistantToolCallDeltaEvent {
  readonly type: 'toolcall_delta'
  readonly contentIndex: number
  readonly toolCallId: string
  readonly delta: string
  readonly input?: JsonValue
}

export interface AgentAssistantToolCallEndEvent {
  readonly type: 'toolcall_end'
  readonly contentIndex: number
  readonly toolCallId: string
  readonly toolName: string
  readonly input: JsonValue
}

export interface AgentAssistantDoneEvent {
  readonly type: 'done'
  readonly reason: 'stop' | 'length' | 'toolUse'
}

export interface AgentAssistantErrorEvent {
  readonly type: 'error'
  readonly reason: 'aborted' | 'error'
  readonly error: AgentTransportErrorInfo
}

export type AgentAssistantMessageEvent =
  | AgentAssistantTextStartEvent
  | AgentAssistantTextDeltaEvent
  | AgentAssistantTextEndEvent
  | AgentAssistantThinkingStartEvent
  | AgentAssistantThinkingDeltaEvent
  | AgentAssistantThinkingEndEvent
  | AgentAssistantToolCallStartEvent
  | AgentAssistantToolCallDeltaEvent
  | AgentAssistantToolCallEndEvent
  | AgentAssistantDoneEvent
  | AgentAssistantErrorEvent

export interface AgentTransportAgentStartEvent extends TransportEventBase {
  readonly type: 'agent_start'
  readonly runId: string
}

export interface AgentTransportAgentEndEvent extends TransportEventBase {
  readonly type: 'agent_end'
  readonly runId: string
  readonly reason: 'stop' | 'length' | 'toolUse' | 'error' | 'aborted' | null
  readonly usage?: {
    readonly promptTokens: number
    readonly completionTokens: number
    readonly totalTokens: number
  }
  readonly error?: AgentTransportErrorInfo
}

export interface AgentTransportTurnStartEvent extends TransportEventBase {
  readonly type: 'turn_start'
  readonly turnIndex: number
}

export interface AgentTransportTurnEndEvent extends TransportEventBase {
  readonly type: 'turn_end'
  readonly turnIndex: number
}

export interface AgentTransportMessageStartEvent extends TransportEventBase {
  readonly type: 'message_start'
  readonly messageId: string
  readonly role: 'user' | 'assistant' | 'system' | 'tool'
}

export interface AgentTransportMessageUpdateEvent extends TransportEventBase {
  readonly type: 'message_update'
  readonly messageId: string
  readonly role: 'assistant'
  readonly assistantMessageEvent: AgentAssistantMessageEvent
}

export interface AgentTransportMessageEndEvent extends TransportEventBase {
  readonly type: 'message_end'
  readonly messageId: string
  readonly role: 'user' | 'assistant' | 'system' | 'tool'
}

export interface AgentTransportToolExecutionStartEvent extends TransportEventBase {
  readonly type: 'tool_execution_start'
  readonly toolCallId: string
  readonly toolName: string
  readonly args: JsonValue
  readonly parentMessageId?: string
}

export interface AgentTransportToolExecutionUpdateEvent extends TransportEventBase {
  readonly type: 'tool_execution_update'
  readonly toolCallId: string
  readonly toolName: string
  readonly args: JsonValue
  readonly partialResult: JsonValue
}

export interface AgentTransportToolExecutionEndEvent extends TransportEventBase {
  readonly type: 'tool_execution_end'
  readonly toolCallId: string
  readonly toolName: string
  readonly args?: JsonValue
  readonly result: JsonValue
  readonly isError: boolean
}

export interface AgentTransportQueueUpdateEvent extends TransportEventBase {
  readonly type: 'queue_update'
  readonly steering: readonly string[]
  readonly followUp: readonly string[]
}

export interface AgentTransportCompactionStartEvent extends TransportEventBase {
  readonly type: 'compaction_start'
  readonly reason: 'manual' | 'threshold' | 'overflow'
}

export interface AgentTransportCompactionEndEvent extends TransportEventBase {
  readonly type: 'compaction_end'
  readonly reason: 'manual' | 'threshold' | 'overflow'
  readonly result: JsonValue
  readonly aborted: boolean
  readonly willRetry: boolean
  readonly errorMessage?: string
}

export interface AgentTransportAutoRetryStartEvent extends TransportEventBase {
  readonly type: 'auto_retry_start'
  readonly attempt: number
  readonly maxAttempts: number
  readonly delayMs: number
  readonly errorMessage: string
}

export interface AgentTransportAutoRetryEndEvent extends TransportEventBase {
  readonly type: 'auto_retry_end'
  readonly success: boolean
  readonly attempt: number
  readonly finalError?: string
}

export interface AgentTransportCustomEvent extends TransportEventBase {
  readonly type: 'custom'
  readonly name: string
  readonly value?: JsonValue
}

export type AgentTransportEvent =
  | AgentTransportAgentStartEvent
  | AgentTransportAgentEndEvent
  | AgentTransportTurnStartEvent
  | AgentTransportTurnEndEvent
  | AgentTransportMessageStartEvent
  | AgentTransportMessageUpdateEvent
  | AgentTransportMessageEndEvent
  | AgentTransportToolExecutionStartEvent
  | AgentTransportToolExecutionUpdateEvent
  | AgentTransportToolExecutionEndEvent
  | AgentTransportQueueUpdateEvent
  | AgentTransportCompactionStartEvent
  | AgentTransportCompactionEndEvent
  | AgentTransportAutoRetryStartEvent
  | AgentTransportAutoRetryEndEvent
  | AgentTransportCustomEvent
