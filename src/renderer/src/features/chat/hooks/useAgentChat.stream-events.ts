import { matchBy } from '@diegogbrisa/ts-match'
import {
  clearLastAgentErrorInfo,
  setLastAgentErrorInfo,
} from '@/features/chat/lib/agent-error-store'
import { applyAgentTransportEvent } from '@/features/chat/lib/chat-stream-state'
import { updateMessagesForSession } from './useAgentChat.message-cache'
import type { AgentEventPayload, AgentStreamEventContext } from './useAgentChat.types'

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

function handleAgentStateEvent(
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
      'turn_start',
      'turn_end',
      'message_start',
      'message_update',
      'message_end',
      'tool_execution_start',
      'tool_execution_update',
      'tool_execution_end',
      'queue_update',
      'custom',
      () => undefined,
    )
    .exhaustive()
}

function shouldHandleStreamPayload(payload: AgentEventPayload, context: AgentStreamEventContext) {
  return (
    payload.sessionId === context.subscribedSessionId &&
    context.currentSessionIdRef.current === context.subscribedSessionId
  )
}

export function handleAgentStreamPayload(
  payload: AgentEventPayload,
  context: AgentStreamEventContext,
) {
  if (!shouldHandleStreamPayload(payload, context)) {
    return
  }

  handleAgentStateEvent(payload.event, context)

  if (context.foregroundStreamActiveRef.current || context.backgroundStreamingRef.current) {
    signalStreamChange(context)
    updateMessagesForSession(
      context.messagesBySessionIdRef,
      context.setMessagesBySessionId,
      context.setRunRenderMessages,
      context.subscribedSessionId,
      (currentMessages) => applyAgentTransportEvent(currentMessages, payload.event),
      { cacheRunSnapshot: true },
    )
  }
}
