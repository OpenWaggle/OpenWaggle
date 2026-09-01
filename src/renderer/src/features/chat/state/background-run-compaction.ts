import type { UIMessage } from '@shared/types/chat-ui'
import type { AgentTransportEvent } from '@shared/types/stream'
import {
  type AgentCompactionStatus,
  type AgentCompactionTimelineItem,
  compactionResultEntryId,
  getTimelineCompactionStatus,
  withoutLatestRunningCompaction,
} from '@/features/chat/lib/compaction-lifecycle'

type CompactionStartEvent = Extract<AgentTransportEvent, { readonly type: 'compaction_start' }>
type CompactionEndEvent = Extract<AgentTransportEvent, { readonly type: 'compaction_end' }>

function durableSummaryCount(messages: readonly UIMessage[]) {
  return messages.filter((message) => message.metadata?.compactionSummary !== undefined).length
}

function applyCompactionStart(
  status: AgentCompactionStatus | null,
  event: CompactionStartEvent,
  messages: readonly UIMessage[],
): AgentCompactionStatus {
  const summaryCountAtStart = durableSummaryCount(messages)
  const priorTimeline = getTimelineCompactionStatus(status)?.timeline ?? []
  const expectedSummaryCount = Math.max(
    summaryCountAtStart + 1,
    (priorTimeline.at(-1)?.expectedSummaryCount ?? summaryCountAtStart) + 1,
  )
  return {
    type: 'compacting',
    reason: event.reason,
    summaryCountAtStart,
    timeline: [
      ...priorTimeline,
      {
        id: `${String(event.timestamp)}:${String(summaryCountAtStart)}`,
        phase: 'running',
        reason: event.reason,
        summaryCountAtStart,
        expectedSummaryCount,
        messageCountAtStart: messages.length,
      },
    ],
  }
}

function completedTimeline(input: {
  readonly status: AgentCompactionStatus | null
  readonly event: CompactionEndEvent
  readonly messages: readonly UIMessage[]
  readonly summaryCountAtStart: number
  readonly expectedSummaryCount: number
}): readonly AgentCompactionTimelineItem[] {
  const timelineStatus = getTimelineCompactionStatus(input.status)
  const latestIsRunning = timelineStatus?.timeline.at(-1)?.phase === 'running'
  const expectedSummaryId = compactionResultEntryId(input.event.result)
  if (latestIsRunning) {
    return timelineStatus.timeline.map((item, index) =>
      index === timelineStatus.timeline.length - 1
        ? {
            ...item,
            phase: 'completed' as const,
            ...(expectedSummaryId ? { expectedSummaryId } : {}),
          }
        : item,
    )
  }
  return [
    ...(timelineStatus?.timeline ?? []),
    {
      id: `${String(input.event.timestamp)}:${String(input.summaryCountAtStart)}`,
      phase: 'completed',
      reason: input.event.reason,
      summaryCountAtStart: input.summaryCountAtStart,
      expectedSummaryCount: input.expectedSummaryCount,
      ...(expectedSummaryId ? { expectedSummaryId } : {}),
      messageCountAtStart: input.messages.length,
    },
  ]
}

function applyCompactionEnd(
  status: AgentCompactionStatus | null,
  event: CompactionEndEvent,
  messages: readonly UIMessage[],
): AgentCompactionStatus | null {
  if (event.aborted || event.errorMessage) return withoutLatestRunningCompaction(status)
  const timelineStatus = getTimelineCompactionStatus(status)
  const latestIsRunning = timelineStatus?.timeline.at(-1)?.phase === 'running'
  const summaryCountAtStart = latestIsRunning
    ? timelineStatus.summaryCountAtStart
    : durableSummaryCount(messages)
  const expectedSummaryCount = Math.max(
    summaryCountAtStart + 1,
    (timelineStatus?.timeline.at(-1)?.expectedSummaryCount ?? summaryCountAtStart) + 1,
  )
  return {
    type: 'completed',
    reason: event.reason,
    summaryCountAtStart,
    timeline: completedTimeline({
      status,
      event,
      messages,
      summaryCountAtStart,
      expectedSummaryCount,
    }),
  }
}

export function applyCompactionSnapshotEvent(
  status: AgentCompactionStatus | null,
  event: AgentTransportEvent,
  messages: readonly UIMessage[],
): AgentCompactionStatus | null {
  if (event.type === 'compaction_start') {
    return applyCompactionStart(status, event, messages)
  }
  if (event.type === 'auto_retry_start') {
    return {
      type: 'retrying',
      attempt: event.attempt,
      maxAttempts: event.maxAttempts,
      delayMs: event.delayMs,
      errorMessage: event.errorMessage,
      previousCompactionStatus: getTimelineCompactionStatus(status),
    }
  }
  if (event.type === 'auto_retry_end') {
    return status?.type === 'retrying' ? status.previousCompactionStatus : status
  }
  if (event.type !== 'compaction_end') return status
  return applyCompactionEnd(status, event, messages)
}
