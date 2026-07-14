import { matchBy } from '@diegogbrisa/ts-match'
import {
  clearLastAgentErrorInfo,
  setLastAgentErrorInfo,
} from '@/features/chat/lib/agent-error-store'
import { applyAgentTransportEvent } from '@/features/chat/lib/chat-stream-state'
import { updateMessagesForSession } from './useAgentChat.message-cache'
import type { AgentEventPayload, AgentStreamEventContext } from './useAgentChat.types'

type InteractionRequestEvent = Extract<
  AgentEventPayload['event'],
  { readonly type: 'agent_interaction_request' }
>
type InteractionResolvedEvent = Extract<
  AgentEventPayload['event'],
  { readonly type: 'agent_interaction_resolved' }
>
type CustomEvent = Extract<AgentEventPayload['event'], { readonly type: 'custom' }>

const CUSTOM_MESSAGE_LIMIT = 20
const INTERACTION_EVENT_LIMIT = 30

function signalStreamChange(context: AgentStreamEventContext) {
  context.streamSignalVersionRef.current += 1
}

function setReadyIfNoActiveRun(context: AgentStreamEventContext) {
  if (!context.foregroundStreamActiveRef.current && !context.backgroundStreamingRef.current) {
    context.setStatus('ready')
  }
}

function handleAgentStartEvent(context: AgentStreamEventContext) {
  signalStreamChange(context)
  clearLastAgentErrorInfo(context.subscribedSessionId)
  context.setError(undefined)
  context.setStatus('streaming')
  if (!context.foregroundStreamActiveRef.current) {
    context.backgroundStreamingRef.current = true
    context.backgroundReconnectSessionIdRef.current = context.subscribedSessionId
    context.setBackgroundStreaming(true)
  }
}

function handleCompactionEndEvent(
  event: Extract<AgentEventPayload['event'], { readonly type: 'compaction_end' }>,
  context: AgentStreamEventContext,
) {
  signalStreamChange(context)
  context.setCompactionStatus(null)
  const hasCompactionError = event.errorMessage !== undefined && !event.aborted
  if (hasCompactionError) {
    const nextError = new Error(event.errorMessage)
    context.setError(nextError)
    context.setStatus('error')
    return
  }
  setReadyIfNoActiveRun(context)
}

function handleAutoRetryEndEvent(
  event: Extract<AgentEventPayload['event'], { readonly type: 'auto_retry_end' }>,
  context: AgentStreamEventContext,
) {
  signalStreamChange(context)
  context.setCompactionStatus(null)
  const hasRetryError = !event.success && event.finalError !== undefined
  if (hasRetryError) {
    const nextError = new Error(event.finalError)
    context.setError(nextError)
    context.setStatus('error')
    return
  }
  setReadyIfNoActiveRun(context)
}

function handleAgentEndEvent(
  event: Extract<AgentEventPayload['event'], { readonly type: 'agent_end' }>,
  context: AgentStreamEventContext,
) {
  if (event.reason !== 'error' || !event.error) {
    return
  }

  signalStreamChange(context)
  const nextError = new Error(event.error.message)
  context.terminalRunErrorRef.current = nextError
  setLastAgentErrorInfo(context.subscribedSessionId, event.error)
  context.setError(nextError)
  context.setStatus('error')
}

function addAgentInteraction(
  sessionId: AgentEventPayload['sessionId'],
  event: InteractionRequestEvent,
  context: AgentStreamEventContext,
) {
  const next = new Map(context.agentInteractionsBySessionIdRef.current)
  const current = next.get(sessionId) ?? []
  next.set(sessionId, [
    ...current.filter(
      (interaction) => interaction.interactionId !== event.interaction.interactionId,
    ),
    event.interaction,
  ])
  context.agentInteractionsBySessionIdRef.current = next
  context.setAgentInteractionsBySessionId(next)
}

function removeAgentInteraction(
  sessionId: AgentEventPayload['sessionId'],
  event: InteractionResolvedEvent,
  context: AgentStreamEventContext,
) {
  const next = new Map(context.agentInteractionsBySessionIdRef.current)
  const current = next.get(sessionId) ?? []
  next.set(
    sessionId,
    current.filter((interaction) => interaction.interactionId !== event.interactionId),
  )
  context.agentInteractionsBySessionIdRef.current = next
  context.setAgentInteractionsBySessionId(next)
}

function addInteractionEvent(
  sessionId: AgentEventPayload['sessionId'],
  event: InteractionRequestEvent | InteractionResolvedEvent,
  context: AgentStreamEventContext,
) {
  const next = new Map(context.agentInteractionEventsBySessionIdRef.current)
  const current = next.get(sessionId) ?? []
  next.set(sessionId, [...current, event].slice(-INTERACTION_EVENT_LIMIT))
  context.agentInteractionEventsBySessionIdRef.current = next
  context.setAgentInteractionEventsBySessionId(next)
}

function addCustomMessage(
  sessionId: AgentEventPayload['sessionId'],
  event: CustomEvent,
  context: AgentStreamEventContext,
) {
  const next = new Map(context.agentCustomMessagesBySessionIdRef.current)
  const current = next.get(sessionId) ?? []
  next.set(sessionId, [...current, event].slice(-CUSTOM_MESSAGE_LIMIT))
  context.agentCustomMessagesBySessionIdRef.current = next
  context.setAgentCustomMessagesBySessionId(next)
}

function handleSessionScopedAgentLoopEvent(
  payload: AgentEventPayload,
  context: AgentStreamEventContext,
) {
  matchBy(payload.event, 'type')
    .with('agent_interaction_request', (value) => {
      signalStreamChange(context)
      addAgentInteraction(payload.sessionId, value, context)
      addInteractionEvent(payload.sessionId, value, context)
    })
    .with('agent_interaction_resolved', (value) => {
      signalStreamChange(context)
      removeAgentInteraction(payload.sessionId, value, context)
      addInteractionEvent(payload.sessionId, value, context)
    })
    .with('custom', (value) => {
      signalStreamChange(context)
      addCustomMessage(payload.sessionId, value, context)
    })
    .otherwise(() => undefined)
}

function handleForegroundAgentStateEvent(
  event: AgentEventPayload['event'],
  context: AgentStreamEventContext,
) {
  matchBy(event, 'type')
    .with('agent_start', () => handleAgentStartEvent(context))
    .with('compaction_start', (value) => {
      signalStreamChange(context)
      context.setError(undefined)
      context.setStatus('compacting')
      context.setCompactionStatus({ type: 'compacting', reason: value.reason })
    })
    .with('compaction_end', (value) => handleCompactionEndEvent(value, context))
    .with('auto_retry_start', (value) => {
      signalStreamChange(context)
      context.setStatus('retrying')
      context.setCompactionStatus({
        type: 'retrying',
        attempt: value.attempt,
        maxAttempts: value.maxAttempts,
        delayMs: value.delayMs,
        errorMessage: value.errorMessage,
      })
    })
    .with('auto_retry_end', (value) => handleAutoRetryEndEvent(value, context))
    .with('agent_end', (value) => handleAgentEndEvent(value, context))
    .with(
      'agent_interaction_request',
      'agent_interaction_resolved',
      'custom',
      'turn_start',
      'turn_end',
      'message_start',
      'message_update',
      'message_end',
      'tool_execution_start',
      'tool_execution_update',
      'tool_execution_end',
      'queue_update',
      () => undefined,
    )
    .exhaustive()
}

function shouldHandleSessionScopedPayload(context: AgentStreamEventContext) {
  return context.subscribedSessionId === context.currentSessionIdRef.current
}

function shouldHandleForegroundStreamPayload(
  payload: AgentEventPayload,
  context: AgentStreamEventContext,
) {
  return (
    shouldHandleSessionScopedPayload(context) && payload.sessionId === context.subscribedSessionId
  )
}

export function handleAgentStreamPayload(
  payload: AgentEventPayload,
  context: AgentStreamEventContext,
) {
  if (!shouldHandleSessionScopedPayload(context)) {
    return
  }

  handleSessionScopedAgentLoopEvent(payload, context)

  if (!shouldHandleForegroundStreamPayload(payload, context)) {
    return
  }

  handleForegroundAgentStateEvent(payload.event, context)

  if (context.foregroundStreamActiveRef.current || context.backgroundStreamingRef.current) {
    signalStreamChange(context)
    updateMessagesForSession(
      context.messagesBySessionIdRef,
      context.setMessagesBySessionId,
      context.setRunRenderMessages,
      payload.sessionId,
      (currentMessages) => applyAgentTransportEvent(currentMessages, payload.event),
      { cacheRunSnapshot: true },
    )
  }
}
