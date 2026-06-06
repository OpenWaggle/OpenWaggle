import { OPENWAGGLE_AGENT_LOOP } from '@shared/constants/agent-loop'
import { safeDecodeUnknown } from '@shared/schema'
import { agentLoopResponseSchema } from '@shared/schemas/agent-loop-interaction'
import type {
  AgentTransportCustomEvent,
  AgentTransportInteractionRequestEvent,
  AgentTransportInteractionResolvedEvent,
} from '@shared/types/stream'
import {
  baseEventFields,
  isObject,
  optionalJsonValue,
  parseJsonObject,
  stringField,
  type UnknownObject,
} from './agent-loop-transcript-event-fields'
import {
  parseErrorInfo,
  parseInteraction,
  parseInteractionKind,
  parseInteractionStatus,
} from './agent-loop-transcript-interactions'

export interface AgentLoopTranscriptNode {
  readonly id: string
  readonly parentId: string | null
  readonly kind: string
  readonly timestampMs: number
  readonly createdOrder: number
  readonly contentJson: string
}

function parseCustomEvent(event: UnknownObject): AgentTransportCustomEvent | null {
  if (event.type !== 'custom') {
    return null
  }

  const base = baseEventFields(event)
  const name = stringField(event, 'name')
  if (base === null || name === null) {
    return null
  }

  const value = optionalJsonValue(event.value)
  return {
    type: 'custom',
    name,
    ...base,
    ...(value !== undefined ? { value } : {}),
  }
}

function parseInteractionRequestEvent(
  event: UnknownObject,
): AgentTransportInteractionRequestEvent | null {
  if (event.type !== 'agent_interaction_request') {
    return null
  }

  const base = baseEventFields(event)
  const interaction = parseInteraction(event.interaction)
  return base !== null && interaction !== null
    ? { type: 'agent_interaction_request', ...base, interaction }
    : null
}

function parseInteractionResolvedEvent(
  event: UnknownObject,
): AgentTransportInteractionResolvedEvent | null {
  if (event.type !== 'agent_interaction_resolved') {
    return null
  }

  const base = baseEventFields(event)
  const runId = stringField(event, 'runId')
  const interactionId = stringField(event, 'interactionId')
  const kind = parseInteractionKind(stringField(event, 'kind'))
  const status = parseInteractionStatus(stringField(event, 'status'))

  if (
    base === null ||
    runId === null ||
    interactionId === null ||
    kind === null ||
    status === null
  ) {
    return null
  }

  const response = safeDecodeUnknown(agentLoopResponseSchema, event.response)
  const error = parseErrorInfo(event.error)

  return {
    type: 'agent_interaction_resolved',
    ...base,
    runId,
    interactionId,
    kind,
    status,
    ...(response.success ? { response: response.data } : {}),
    ...(error !== undefined ? { error } : {}),
  }
}

export function parseAgentLoopEvent(
  event: unknown,
):
  | AgentTransportCustomEvent
  | AgentTransportInteractionRequestEvent
  | AgentTransportInteractionResolvedEvent
  | null {
  if (!isObject(event)) {
    return null
  }

  return (
    parseCustomEvent(event) ??
    parseInteractionRequestEvent(event) ??
    parseInteractionResolvedEvent(event)
  )
}

export function isAgentLoopTranscriptNode(node: AgentLoopTranscriptNode) {
  if (node.kind !== 'custom') {
    return false
  }

  const content = parseJsonObject(node.contentJson)
  return content?.customType === OPENWAGGLE_AGENT_LOOP.SESSION_EVENT_CUSTOM_TYPE
}

export function readAgentLoopEventFromNode(node: AgentLoopTranscriptNode) {
  if (!isAgentLoopTranscriptNode(node)) {
    return null
  }

  const content = parseJsonObject(node.contentJson)
  return content ? parseAgentLoopEvent(content.event) : null
}
