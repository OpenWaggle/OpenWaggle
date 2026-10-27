import { matchBy } from '@diegogbrisa/ts-match'
import type { UIMessage } from '@shared/types/chat-ui'
import {
  clearLastAgentErrorInfo,
  setLastAgentErrorInfo,
} from '@/features/chat/lib/agent-error-store'
import { applyAgentTransportEvent } from '@/features/chat/lib/chat-stream-state'
import { isPiSessionFileRefusal } from '@/features/chat/lib/message-delivery'
import { publishLiveStreamMessage } from '../state/live-stream-message-store'
import { handleCompactionEndEvent } from './useAgentChat.compaction-events'
import { getMessagesForSession, updateMessagesForSession } from './useAgentChat.message-cache'
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
  const hasRetryError = !event.success && !event.cancelled && event.finalError !== undefined
  if (hasRetryError) {
    const nextError = new Error(event.finalError)
    context.setError(nextError)
    context.setStatus('error')
    return
  }
  setReadyIfNoActiveRun(context)
}

/**
 * The retried response started streaming: the retry wait is over. Pi reports the retry's success
 * only when that response ends, so its status would otherwise stay under the streaming reply.
 */
function handleAssistantMessageStartEvent(context: AgentStreamEventContext) {
  const retryStatus = context.compactionStatusRef.current
  if (retryStatus?.type !== 'retrying') return
  signalStreamChange(context)
  context.setCompactionStatus(retryStatus.previousCompactionStatus)
  context.setStatus('streaming')
}

function handleAgentEndEvent(
  event: Extract<AgentEventPayload['event'], { readonly type: 'agent_end' }>,
  context: AgentStreamEventContext,
) {
  if (event.reason !== 'error' || event.willRetry || !event.error) {
    return
  }

  signalStreamChange(context)
  const nextError = new Error(event.error.message)
  context.terminalRunErrorRef.current = nextError
  // Its send hears of it; the Session's notice, not an error card, says why.
  if (isPiSessionFileRefusal(nextError)) return
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
    .with('message_start', (value) => {
      if (value.role === 'assistant') handleAssistantMessageStartEvent(context)
    })
    .with('agent_end', (value) => handleAgentEndEvent(value, context))
    .with(
      'agent_interaction_request',
      'agent_interaction_resolved',
      'custom',
      'turn_start',
      'turn_end',
      'message_update',
      'message_end',
      'context_usage',
      'tool_execution_start',
      'tool_execution_update',
      'tool_execution_end',
      'queue_update',
      'extension_status',
      'agent_settled',
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

/**
 * Whether the route streams this Session's Run in the background. The route reuses one chat hook
 * across Sessions, so the flag alone may still be the previous Session's: writing this Session's
 * route transcript then replaced its render snapshot, and the run-start seed with it.
 */
function isStreamingInBackground(payload: AgentEventPayload, context: AgentStreamEventContext) {
  return (
    context.backgroundStreamingRef.current &&
    context.backgroundReconnectSessionIdRef.current === payload.sessionId
  )
}

function isStreamedToken(event: AgentEventPayload['event']) {
  if (event.type !== 'message_update') return false
  const type = event.assistantMessageEvent.type
  return type === 'text_delta' || type === 'thinking_delta'
}

/**
 * The message a token only lengthened: the token changed one message, and none of its parts were
 * added or removed. Anything else (a new part, a started message) changes the transcript's rows.
 */
function lengthenedMessage(before: readonly UIMessage[], after: readonly UIMessage[]) {
  if (before === after || before.length !== after.length) return null
  let changed: UIMessage | null = null
  for (let index = 0; index < after.length; index += 1) {
    const previous = before[index]
    const next = after[index]
    if (previous === next) continue
    if (changed || !previous || !next || previous.id !== next.id) return null
    if (previous.parts.length !== next.parts.length) return null
    changed = next
  }
  return changed
}

/**
 * Applies a streamed text or reasoning token without committing the chat's message list (B2).
 *
 * The list in `messagesBySessionIdRef` takes the token, so the next event and the next commit
 * build on it, and the message's bubble renders it from the live store. Returns `false` when the
 * event must commit as before.
 */
function applyStreamedToken(payload: AgentEventPayload, context: AgentStreamEventContext) {
  if (!isStreamedToken(payload.event)) return false
  const before = getMessagesForSession(context.messagesBySessionIdRef, payload.sessionId)
  const after = applyAgentTransportEvent(before, payload.event)
  const message = lengthenedMessage(before, after)
  if (!message) return false
  const next = new Map(context.messagesBySessionIdRef.current)
  next.set(payload.sessionId, after)
  context.messagesBySessionIdRef.current = next
  context.setRunRenderMessages(payload.sessionId, after)
  publishLiveStreamMessage(payload.sessionId, message)
  return true
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

  if (context.foregroundStreamActiveRef.current || isStreamingInBackground(payload, context)) {
    if (applyStreamedToken(payload, context)) return
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
