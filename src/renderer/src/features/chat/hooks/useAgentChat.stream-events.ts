import { matchBy } from '@diegogbrisa/ts-match'
import {
  clearLastAgentErrorInfo,
  setLastAgentErrorInfo,
} from '@/features/chat/lib/agent-error-store'
import { applyAgentTransportEvent } from '@/features/chat/lib/chat-stream-state'
import { handleCompactionEndEvent } from './useAgentChat.compaction-events'
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

function handleAutoRetryEndEvent(
  event: Extract<AgentEventPayload['event'], { readonly type: 'auto_retry_end' }>,
  context: AgentStreamEventContext,
) {
  signalStreamChange(context)
  const retryStatus = context.compactionStatusRef.current
  context.setCompactionStatus(
    retryStatus?.type === 'retrying' ? retryStatus.previousCompactionStatus : retryStatus,
  )
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

function handleForegroundAgentStateEvent(
  event: AgentEventPayload['event'],
  context: AgentStreamEventContext,
) {
  matchBy(event, 'type')
    .with('agent_start', () => handleAgentStartEvent(context))
    .with('compaction_start', (value) => {
      signalStreamChange(context)
      const currentMessages =
        context.messagesBySessionIdRef.current.get(context.subscribedSessionId) ?? []
      const summaryCountAtStart = currentMessages.filter(
        (message) => message.metadata?.compactionSummary !== undefined,
      ).length
      const current = context.compactionStatusRef.current
      const priorStatus = current?.type === 'retrying' ? current.previousCompactionStatus : current
      const priorTimeline = priorStatus?.timeline ?? []
      const expectedSummaryCount = Math.max(
        summaryCountAtStart + 1,
        (priorTimeline.at(-1)?.expectedSummaryCount ?? summaryCountAtStart) + 1,
      )
      const timeline = [
        ...priorTimeline,
        {
          id: `${String(value.timestamp)}:${String(summaryCountAtStart)}`,
          phase: 'running' as const,
          reason: value.reason,
          summaryCountAtStart,
          expectedSummaryCount,
          messageCountAtStart: currentMessages.length,
        },
      ]
      context.compactionSummaryCountAtStartRef.current = summaryCountAtStart
      context.setError(undefined)
      context.setStatus('compacting')
      context.setCompactionStatus({
        type: 'compacting',
        reason: value.reason,
        summaryCountAtStart,
        timeline,
      })
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
        previousCompactionStatus:
          context.compactionStatusRef.current?.type === 'retrying'
            ? context.compactionStatusRef.current.previousCompactionStatus
            : context.compactionStatusRef.current,
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
      'context_usage',
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
