import {
  compactionResultEntryId,
  getTimelineCompactionStatus,
  withoutLatestRunningCompaction,
} from '../lib/compaction-lifecycle'
import type { AgentEventPayload, AgentStreamEventContext } from './useAgentChat.types'

function signalStreamChange(context: AgentStreamEventContext) {
  context.streamSignalVersionRef.current += 1
}

function setReadyIfNoActiveRun(context: AgentStreamEventContext) {
  if (!context.foregroundStreamActiveRef.current && !context.backgroundStreamingRef.current) {
    context.setStatus('ready')
  }
}

function settleManualCompaction(
  event: Extract<AgentEventPayload['event'], { readonly type: 'compaction_end' }>,
  context: AgentStreamEventContext,
) {
  if (event.reason !== 'manual') return
  context.backgroundStreamingRef.current = false
  context.backgroundReconnectSessionIdRef.current = null
  context.setBackgroundStreaming(false)
}

function compactionFailureStatus(
  event: Extract<AgentEventPayload['event'], { readonly type: 'compaction_end' }>,
  context: AgentStreamEventContext,
) {
  return event.reason !== 'manual' && context.foregroundStreamActiveRef.current
    ? ('streaming' as const)
    : ('error' as const)
}

export function handleCompactionEndEvent(
  event: Extract<AgentEventPayload['event'], { readonly type: 'compaction_end' }>,
  context: AgentStreamEventContext,
) {
  signalStreamChange(context)
  settleManualCompaction(event, context)
  const hasCompactionError = event.errorMessage !== undefined && !event.aborted
  if (hasCompactionError) {
    context.setCompactionStatus(withoutLatestRunningCompaction(context.compactionStatusRef.current))
    const nextError = new Error(event.errorMessage)
    context.setError(nextError)
    context.setStatus(compactionFailureStatus(event, context))
    return
  }
  const currentMessages =
    context.messagesBySessionIdRef.current.get(context.subscribedSessionId) ?? []
  const current = context.compactionStatusRef.current
  if (event.aborted) {
    context.setCompactionStatus(withoutLatestRunningCompaction(current))
    setReadyIfNoActiveRun(context)
    return
  }
  const activeCompaction = getTimelineCompactionStatus(current)
  const latestIsRunning = activeCompaction?.timeline.at(-1)?.phase === 'running'
  const durableSummaryCount = currentMessages.filter(
    (message) => message.metadata?.compactionSummary !== undefined,
  ).length
  const summaryCountAtStart = latestIsRunning
    ? activeCompaction.summaryCountAtStart
    : durableSummaryCount
  const nextExpectedSummaryCount = Math.max(
    summaryCountAtStart + 1,
    (activeCompaction?.timeline.at(-1)?.expectedSummaryCount ?? summaryCountAtStart) + 1,
  )
  const expectedSummaryId = compactionResultEntryId(event.result)
  context.compactionSummaryCountAtStartRef.current = summaryCountAtStart
  const timeline = latestIsRunning
    ? activeCompaction.timeline.map((item, index) =>
        index === activeCompaction.timeline.length - 1
          ? {
              ...item,
              phase: 'completed' as const,
              ...(expectedSummaryId ? { expectedSummaryId } : {}),
            }
          : item,
      )
    : [
        ...(activeCompaction?.timeline ?? []),
        {
          id: `${String(event.timestamp)}:${String(summaryCountAtStart)}`,
          phase: 'completed' as const,
          reason: event.reason,
          summaryCountAtStart,
          expectedSummaryCount: nextExpectedSummaryCount,
          ...(expectedSummaryId ? { expectedSummaryId } : {}),
          messageCountAtStart: currentMessages.length,
        },
      ]
  context.setCompactionStatus({
    type: 'completed',
    reason: event.reason,
    summaryCountAtStart,
    timeline,
  })
  setReadyIfNoActiveRun(context)
}
