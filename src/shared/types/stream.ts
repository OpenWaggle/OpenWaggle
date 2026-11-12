/**
 * OpenWaggle-owned transport events sent over IPC between main and renderer, inferred from the
 * schemas in `@shared/schemas/stream` and `@shared/schemas/stream-assistant-events`.
 *
 * These events intentionally mirror Pi session/runtime semantics closely while remaining
 * vendor-free shared types.
 */

import type { SchemaType } from '@shared/schema'
import type { agentTransportUserMessageSchema } from '@shared/schemas/agent-transport-user-message'
import type {
  agentExtensionStatusSlotSchema,
  agentTransportAgentEndEventSchema,
  agentTransportAgentSettledEventSchema,
  agentTransportAgentStartEventSchema,
  agentTransportAutoRetryEndEventSchema,
  agentTransportAutoRetryStartEventSchema,
  agentTransportCompactionEndEventSchema,
  agentTransportCompactionStartEventSchema,
  agentTransportContextUsageEventSchema,
  agentTransportCustomEventSchema,
  agentTransportEventSchema,
  agentTransportExtensionStatusEventSchema,
  agentTransportInteractionRequestEventSchema,
  agentTransportInteractionResolvedEventSchema,
  agentTransportMessageEndEventSchema,
  agentTransportMessageStartEventSchema,
  agentTransportMessageUpdateEventSchema,
  agentTransportQueueUpdateEventSchema,
  agentTransportToolExecutionEndEventSchema,
  agentTransportToolExecutionStartEventSchema,
  agentTransportToolExecutionUpdateEventSchema,
  agentTransportTurnEndEventSchema,
  agentTransportTurnStartEventSchema,
} from '@shared/schemas/stream'
import type {
  agentAssistantDoneEventSchema,
  agentAssistantErrorEventSchema,
  agentAssistantMessageEventSchema,
  agentAssistantTextDeltaEventSchema,
  agentAssistantTextEndEventSchema,
  agentAssistantTextStartEventSchema,
  agentAssistantThinkingDeltaEventSchema,
  agentAssistantThinkingEndEventSchema,
  agentAssistantThinkingStartEventSchema,
  agentAssistantToolCallDeltaEventSchema,
  agentAssistantToolCallEndEventSchema,
  agentAssistantToolCallStartEventSchema,
  agentTransportErrorInfoSchema,
} from '@shared/schemas/stream-assistant-events'

export type AgentTransportErrorInfo = SchemaType<typeof agentTransportErrorInfoSchema>

export type AgentAssistantTextStartEvent = SchemaType<typeof agentAssistantTextStartEventSchema>
export type AgentAssistantTextDeltaEvent = SchemaType<typeof agentAssistantTextDeltaEventSchema>
export type AgentAssistantTextEndEvent = SchemaType<typeof agentAssistantTextEndEventSchema>
export type AgentAssistantThinkingStartEvent = SchemaType<
  typeof agentAssistantThinkingStartEventSchema
>
export type AgentAssistantThinkingDeltaEvent = SchemaType<
  typeof agentAssistantThinkingDeltaEventSchema
>
export type AgentAssistantThinkingEndEvent = SchemaType<typeof agentAssistantThinkingEndEventSchema>
export type AgentAssistantToolCallStartEvent = SchemaType<
  typeof agentAssistantToolCallStartEventSchema
>
export type AgentAssistantToolCallDeltaEvent = SchemaType<
  typeof agentAssistantToolCallDeltaEventSchema
>
export type AgentAssistantToolCallEndEvent = SchemaType<typeof agentAssistantToolCallEndEventSchema>
export type AgentAssistantDoneEvent = SchemaType<typeof agentAssistantDoneEventSchema>
export type AgentAssistantErrorEvent = SchemaType<typeof agentAssistantErrorEventSchema>
export type AgentAssistantMessageEvent = SchemaType<typeof agentAssistantMessageEventSchema>

/**
 * A user message Pi has started incorporating into the active Run, as the transcript shows it.
 * Carries the same source-free display parts and identity the persisted user node projects, never
 * Pi's model input (synthesized attachment text or image payloads).
 */
export type AgentTransportUserMessage = SchemaType<typeof agentTransportUserMessageSchema>

export type AgentTransportAgentStartEvent = SchemaType<typeof agentTransportAgentStartEventSchema>
export type AgentTransportAgentEndEvent = SchemaType<typeof agentTransportAgentEndEventSchema>
export type AgentTransportTurnStartEvent = SchemaType<typeof agentTransportTurnStartEventSchema>
export type AgentTransportTurnEndEvent = SchemaType<typeof agentTransportTurnEndEventSchema>
export type AgentTransportMessageStartEvent = SchemaType<
  typeof agentTransportMessageStartEventSchema
>
export type AgentTransportMessageUpdateEvent = SchemaType<
  typeof agentTransportMessageUpdateEventSchema
>
export type AgentTransportMessageEndEvent = SchemaType<typeof agentTransportMessageEndEventSchema>
export type AgentTransportContextUsageEvent = SchemaType<
  typeof agentTransportContextUsageEventSchema
>
export type AgentTransportToolExecutionStartEvent = SchemaType<
  typeof agentTransportToolExecutionStartEventSchema
>
export type AgentTransportToolExecutionUpdateEvent = SchemaType<
  typeof agentTransportToolExecutionUpdateEventSchema
>
export type AgentTransportToolExecutionEndEvent = SchemaType<
  typeof agentTransportToolExecutionEndEventSchema
>
export type AgentTransportQueueUpdateEvent = SchemaType<typeof agentTransportQueueUpdateEventSchema>
export type AgentTransportCompactionStartEvent = SchemaType<
  typeof agentTransportCompactionStartEventSchema
>
export type AgentTransportCompactionEndEvent = SchemaType<
  typeof agentTransportCompactionEndEventSchema
>
export type AgentTransportAutoRetryStartEvent = SchemaType<
  typeof agentTransportAutoRetryStartEventSchema
>
export type AgentTransportAutoRetryEndEvent = SchemaType<
  typeof agentTransportAutoRetryEndEventSchema
>
export type AgentTransportCustomEvent = SchemaType<typeof agentTransportCustomEventSchema>
export type AgentTransportInteractionRequestEvent = SchemaType<
  typeof agentTransportInteractionRequestEventSchema
>
export type AgentTransportInteractionResolvedEvent = SchemaType<
  typeof agentTransportInteractionResolvedEventSchema
>
export type AgentExtensionStatusSlot = SchemaType<typeof agentExtensionStatusSlotSchema>
export type AgentTransportExtensionStatusEvent = SchemaType<
  typeof agentTransportExtensionStatusEventSchema
>
export type AgentTransportAgentSettledEvent = SchemaType<
  typeof agentTransportAgentSettledEventSchema
>
export type AgentTransportEvent = SchemaType<typeof agentTransportEventSchema>
