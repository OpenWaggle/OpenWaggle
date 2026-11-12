import { Schema } from '@shared/schema'
import { agentLoopResponseSchema } from './agent-loop-interaction'
import {
  agentLoopInteractionKindSchema,
  agentLoopInteractionSchema,
  agentLoopInteractionStatusSchema,
} from './agent-loop-interaction-request'
import { agentTransportUserMessageSchema } from './agent-transport-user-message'
import {
  agentAssistantMessageEventSchema,
  agentTransportErrorInfoSchema,
} from './stream-assistant-events'
import { jsonValueSchema } from './validation'

/**
 * OpenWaggle-owned transport events sent over IPC between main and renderer: the single source of
 * the event types in `@shared/types/stream`.
 *
 * These events intentionally mirror Pi session/runtime semantics closely while remaining
 * vendor-free shared types.
 */

export const transportEventBaseFields = {
  timestamp: Schema.Number,
  model: Schema.optionalWith(Schema.String, { exact: true }),
  rawEvent: Schema.optionalWith(jsonValueSchema, { exact: true }),
}

function transportEvent<const Type extends string, Fields extends Schema.Struct.Fields>(
  type: Type,
  fields: Fields,
) {
  return Schema.Struct({ ...transportEventBaseFields, type: Schema.Literal(type), ...fields })
}

const messageRoleSchema = Schema.Literal('user', 'assistant', 'system', 'tool')
const compactionReasonSchema = Schema.Literal('manual', 'threshold', 'overflow')
const optionalString = Schema.optionalWith(Schema.String, { exact: true })

/**
 * Set when another tool made this call through Pi `ctx.executeTool()`: the id of the calling tool
 * call. Nested calls have no transcript entry of their own; they belong under their parent.
 */
const parentToolCallId = optionalString

export const agentTransportAgentStartEventSchema = transportEvent('agent_start', {
  runId: Schema.String,
})

export const agentTransportAgentEndEventSchema = transportEvent('agent_end', {
  runId: Schema.String,
  reason: Schema.NullOr(Schema.Literal('stop', 'length', 'toolUse', 'error', 'aborted')),
  willRetry: Schema.optionalWith(Schema.Boolean, { exact: true }),
  usage: Schema.optionalWith(
    Schema.Struct({
      promptTokens: Schema.Number,
      completionTokens: Schema.Number,
      totalTokens: Schema.Number,
    }),
    { exact: true },
  ),
  error: Schema.optionalWith(agentTransportErrorInfoSchema, { exact: true }),
})

export const agentTransportTurnStartEventSchema = transportEvent('turn_start', {
  turnIndex: Schema.Number,
})

export const agentTransportTurnEndEventSchema = transportEvent('turn_end', {
  turnIndex: Schema.Number,
})

export const agentTransportMessageStartEventSchema = transportEvent('message_start', {
  messageId: Schema.String,
  role: messageRoleSchema,
  /** Present on a user message: its display content from the moment Pi reads it. */
  userMessage: Schema.optionalWith(agentTransportUserMessageSchema, { exact: true }),
})

export const agentTransportMessageUpdateEventSchema = transportEvent('message_update', {
  messageId: Schema.String,
  role: Schema.Literal('assistant'),
  assistantMessageEvent: agentAssistantMessageEventSchema,
})

export const agentTransportMessageEndEventSchema = transportEvent('message_end', {
  messageId: Schema.String,
  role: messageRoleSchema,
  /** The provider error a failed assistant response ended with. */
  errorMessage: optionalString,
})

/** Authoritative context usage reported after a completed model response. */
export const agentTransportContextUsageEventSchema = transportEvent('context_usage', {
  tokens: Schema.Number,
  contextWindow: Schema.Number,
  /**
   * The virtual model the Run selected, when its router sent this response to `model`. The usage
   * and window are `model`'s; the selection only tells the context meter they belong to it.
   */
  routedFrom: optionalString,
})

export const agentTransportToolExecutionStartEventSchema = transportEvent('tool_execution_start', {
  toolCallId: Schema.String,
  toolName: Schema.String,
  args: jsonValueSchema,
  parentMessageId: optionalString,
  parentToolCallId,
})

export const agentTransportToolExecutionUpdateEventSchema = transportEvent(
  'tool_execution_update',
  {
    toolCallId: Schema.String,
    toolName: Schema.String,
    args: jsonValueSchema,
    partialResult: jsonValueSchema,
    parentToolCallId,
  },
)

export const agentTransportToolExecutionEndEventSchema = transportEvent('tool_execution_end', {
  toolCallId: Schema.String,
  toolName: Schema.String,
  args: Schema.optionalWith(jsonValueSchema, { exact: true }),
  result: jsonValueSchema,
  isError: Schema.Boolean,
  parentToolCallId,
})

export const agentTransportQueueUpdateEventSchema = transportEvent('queue_update', {
  steering: Schema.Array(Schema.String),
  followUp: Schema.Array(Schema.String),
})

export const agentTransportCompactionStartEventSchema = transportEvent('compaction_start', {
  reason: compactionReasonSchema,
})

export const agentTransportCompactionEndEventSchema = transportEvent('compaction_end', {
  reason: compactionReasonSchema,
  result: jsonValueSchema,
  aborted: Schema.Boolean,
  willRetry: Schema.Boolean,
  errorMessage: Schema.optional(Schema.String),
})

export const agentTransportAutoRetryStartEventSchema = transportEvent('auto_retry_start', {
  attempt: Schema.Number,
  maxAttempts: Schema.Number,
  delayMs: Schema.Number,
  errorMessage: Schema.String,
})

export const agentTransportAutoRetryEndEventSchema = transportEvent('auto_retry_end', {
  success: Schema.Boolean,
  attempt: Schema.Number,
  finalError: optionalString,
  cancelled: Schema.optionalWith(Schema.Boolean, { exact: true }),
})

export const agentTransportCustomEventSchema = transportEvent('custom', {
  name: Schema.String,
  value: Schema.optionalWith(jsonValueSchema, { exact: true }),
})

export const agentTransportInteractionRequestEventSchema = transportEvent(
  'agent_interaction_request',
  { interaction: agentLoopInteractionSchema },
)

export const agentTransportInteractionResolvedEventSchema = transportEvent(
  'agent_interaction_resolved',
  {
    runId: Schema.String,
    interactionId: Schema.String,
    kind: agentLoopInteractionKindSchema,
    status: agentLoopInteractionStatusSchema,
    response: Schema.optionalWith(agentLoopResponseSchema, { exact: true }),
    error: Schema.optionalWith(agentTransportErrorInfoSchema, { exact: true }),
  },
)

export const agentExtensionStatusSlotSchema = Schema.Union(
  Schema.Struct({ kind: Schema.Literal('status'), key: Schema.String }),
  Schema.Struct({ kind: Schema.Literal('working-message') }),
)

/** Pi `ctx.ui.setStatus(key, text)` or `setWorkingMessage(text)`; no `text` clears it. Live only. */
export const agentTransportExtensionStatusEventSchema = transportEvent('extension_status', {
  runId: Schema.String,
  slot: agentExtensionStatusSlotSchema,
  text: optionalString,
})

/**
 * Pi `agent_settled`: Pi's post-loop work (`agent_before_settle` handlers) is done. Stop stops that
 * work after a terminal `agent_end`; after this event only the Host's own settlement is left.
 */
export const agentTransportAgentSettledEventSchema = transportEvent('agent_settled', {
  runId: Schema.String,
  aborted: Schema.Boolean,
})

export const agentTransportEventSchema = Schema.Union(
  agentTransportAgentStartEventSchema,
  agentTransportAgentEndEventSchema,
  agentTransportTurnStartEventSchema,
  agentTransportTurnEndEventSchema,
  agentTransportMessageStartEventSchema,
  agentTransportMessageUpdateEventSchema,
  agentTransportMessageEndEventSchema,
  agentTransportContextUsageEventSchema,
  agentTransportToolExecutionStartEventSchema,
  agentTransportToolExecutionUpdateEventSchema,
  agentTransportToolExecutionEndEventSchema,
  agentTransportQueueUpdateEventSchema,
  agentTransportCompactionStartEventSchema,
  agentTransportCompactionEndEventSchema,
  agentTransportAutoRetryStartEventSchema,
  agentTransportAutoRetryEndEventSchema,
  agentTransportCustomEventSchema,
  agentTransportInteractionRequestEventSchema,
  agentTransportInteractionResolvedEventSchema,
  agentTransportExtensionStatusEventSchema,
  agentTransportAgentSettledEventSchema,
)
