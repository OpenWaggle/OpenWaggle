import type { AgentSessionEvent } from '@mariozechner/pi-coding-agent'
import type { JsonValue } from '@shared/types/json'
import type { SupportedModelId } from '@shared/types/llm'
import type { AgentTransportEvent } from '@shared/types/stream'

export interface SessionListenerInput {
  readonly model: SupportedModelId
  readonly onEvent: (event: AgentTransportEvent) => void
}

export interface SessionListenerState {
  readonly input: SessionListenerInput
  readonly runId: string
  currentMessageId: string | null
  readonly thinkingSteps: Set<string>
  readonly startedToolCalls: Set<string>
  readonly toolCallInputs: Map<string, JsonValue>
}

export interface PiAssistantToolCall {
  readonly id: string
  readonly name: string
  readonly arguments: unknown
}

export type MessageStartSessionEvent = Extract<AgentSessionEvent, { type: 'message_start' }>
export type MessageUpdateSessionEvent = Extract<AgentSessionEvent, { type: 'message_update' }>
export type MessageEndSessionEvent = Extract<AgentSessionEvent, { type: 'message_end' }>
export type QueueUpdateSessionEvent = Extract<AgentSessionEvent, { type: 'queue_update' }>
export type CompactionStartSessionEvent = Extract<AgentSessionEvent, { type: 'compaction_start' }>
export type CompactionEndSessionEvent = Extract<AgentSessionEvent, { type: 'compaction_end' }>
export type AutoRetryStartSessionEvent = Extract<AgentSessionEvent, { type: 'auto_retry_start' }>
export type AutoRetryEndSessionEvent = Extract<AgentSessionEvent, { type: 'auto_retry_end' }>
export type AgentEndSessionEvent = Extract<AgentSessionEvent, { type: 'agent_end' }>
export type ToolExecutionStartSessionEvent = Extract<
  AgentSessionEvent,
  { type: 'tool_execution_start' }
>
export type ToolExecutionUpdateSessionEvent = Extract<
  AgentSessionEvent,
  { type: 'tool_execution_update' }
>
export type ToolExecutionEndSessionEvent = Extract<
  AgentSessionEvent,
  { type: 'tool_execution_end' }
>

export type AssistantMessageEvent = MessageUpdateSessionEvent['assistantMessageEvent']
export type TextDeltaAssistantEvent = Extract<AssistantMessageEvent, { type: 'text_delta' }>
export type ThinkingStartAssistantEvent = Extract<AssistantMessageEvent, { type: 'thinking_start' }>
export type ThinkingDeltaAssistantEvent = Extract<AssistantMessageEvent, { type: 'thinking_delta' }>
export type ToolCallStartAssistantEvent = Extract<AssistantMessageEvent, { type: 'toolcall_start' }>
export type ToolCallDeltaAssistantEvent = Extract<AssistantMessageEvent, { type: 'toolcall_delta' }>
export type ToolCallEndAssistantEvent = Extract<AssistantMessageEvent, { type: 'toolcall_end' }>
