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
  agentTransportCustomEventSchema,
  agentTransportEventSchema,
  agentTransportInteractionRequestEventSchema,
  agentTransportInteractionResolvedEventSchema,
  agentTransportMessageStartEventSchema,
  agentTransportMessageUpdateEventSchema,
  agentTransportAgentEndEventSchema,
} from '@shared/schemas/stream'
import type { agentAssistantMessageEventSchema } from '@shared/schemas/stream-assistant-events'

export type AgentAssistantMessageEvent = SchemaType<typeof agentAssistantMessageEventSchema>

/**
 * A user message Pi has started incorporating into the active Run, as the transcript shows it.
 * Carries the same source-free display parts and identity the persisted user node projects, never
 * Pi's model input (synthesized attachment text or image payloads).
 */
export type AgentTransportUserMessage = SchemaType<typeof agentTransportUserMessageSchema>

export type AgentTransportAgentEndEvent = SchemaType<typeof agentTransportAgentEndEventSchema>

export type AgentTransportMessageStartEvent = SchemaType<
  typeof agentTransportMessageStartEventSchema
>
export type AgentTransportMessageUpdateEvent = SchemaType<
  typeof agentTransportMessageUpdateEventSchema
>
export type AgentTransportCustomEvent = SchemaType<typeof agentTransportCustomEventSchema>
export type AgentTransportInteractionRequestEvent = SchemaType<
  typeof agentTransportInteractionRequestEventSchema
>
export type AgentTransportInteractionResolvedEvent = SchemaType<
  typeof agentTransportInteractionResolvedEventSchema
>
export type AgentExtensionStatusSlot = SchemaType<typeof agentExtensionStatusSlotSchema>
export type AgentTransportEvent = SchemaType<typeof agentTransportEventSchema>
