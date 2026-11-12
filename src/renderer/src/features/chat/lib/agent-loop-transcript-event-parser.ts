import { OPENWAGGLE_AGENT_LOOP } from '@shared/constants/agent-loop'
import { Schema } from '@shared/schema'
import { agentLoopResponseSchema } from '@shared/schemas/agent-loop-interaction'
import { lenientExactOptional } from '@shared/schemas/lenient-exact'
import {
  agentTransportCustomEventSchema,
  agentTransportInteractionRequestEventSchema,
  agentTransportInteractionResolvedEventSchema,
} from '@shared/schemas/stream'
import { jsonValueSchema } from '@shared/schemas/validation'
import type {
  AgentTransportCustomEvent,
  AgentTransportInteractionRequestEvent,
  AgentTransportInteractionResolvedEvent,
} from '@shared/types/stream'
import { Option } from 'effect'
import {
  persistedTransportErrorInfoSchema,
  persistedTransportEventBaseFields,
} from './agent-loop-transcript-event-fields'
import { persistedAgentLoopInteractionSchema } from './agent-loop-transcript-interactions'

export interface AgentLoopTranscriptNode {
  readonly id: string
  readonly parentId: string | null
  readonly kind: string
  readonly timestampMs: number
  readonly createdOrder: number
  /** Only audit nodes carry content in a Session tree (B5); other nodes never match. */
  readonly contentJson?: string
}

const persistedCustomEventSchema = Schema.Struct({
  ...agentTransportCustomEventSchema.fields,
  ...persistedTransportEventBaseFields,
  value: lenientExactOptional(jsonValueSchema),
})

const persistedInteractionRequestEventSchema = Schema.Struct({
  ...agentTransportInteractionRequestEventSchema.fields,
  ...persistedTransportEventBaseFields,
  interaction: persistedAgentLoopInteractionSchema,
})

/** A resolution keeps its identity and status; a response or error that does not decode is left out. */
const persistedInteractionResolvedEventSchema = Schema.Struct({
  ...agentTransportInteractionResolvedEventSchema.fields,
  ...persistedTransportEventBaseFields,
  response: lenientExactOptional(agentLoopResponseSchema),
  error: lenientExactOptional(persistedTransportErrorInfoSchema),
})

const decodeAgentLoopEvent = Schema.decodeUnknownOption(
  Schema.Union(
    persistedCustomEventSchema,
    persistedInteractionRequestEventSchema,
    persistedInteractionResolvedEventSchema,
  ),
)

export function parseAgentLoopEvent(
  event: unknown,
):
  | AgentTransportCustomEvent
  | AgentTransportInteractionRequestEvent
  | AgentTransportInteractionResolvedEvent
  | null {
  return Option.getOrNull(decodeAgentLoopEvent(event))
}

/** A persisted Agent loop session event's content, as an audit node stores it. */
const decodeAgentLoopSessionEventContent = Schema.decodeUnknownOption(
  Schema.parseJson(
    Schema.Struct({
      customType: Schema.Literal(OPENWAGGLE_AGENT_LOOP.SESSION_EVENT_CUSTOM_TYPE),
      event: Schema.Unknown,
    }),
  ),
)

function agentLoopSessionEventContent(node: AgentLoopTranscriptNode) {
  if (node.kind !== 'custom' || !node.contentJson) return Option.none()
  return decodeAgentLoopSessionEventContent(node.contentJson)
}

export function isAgentLoopTranscriptNode(node: AgentLoopTranscriptNode) {
  return Option.isSome(agentLoopSessionEventContent(node))
}

export function readAgentLoopEventFromNode(node: AgentLoopTranscriptNode) {
  const content = agentLoopSessionEventContent(node)
  return Option.isSome(content) ? parseAgentLoopEvent(content.value.event) : null
}
