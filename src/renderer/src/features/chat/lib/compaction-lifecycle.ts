export interface AgentCompactionTimelineItem {
  readonly id: string
  readonly phase: 'running' | 'completed'
  readonly reason: 'manual' | 'threshold' | 'overflow'
  readonly summaryCountAtStart: number
  readonly expectedSummaryCount?: number
  readonly expectedSummaryId?: string
  readonly messageCountAtStart: number
}

export type AgentCompactionStatus =
  | {
      readonly type: 'compacting' | 'completed'
      readonly reason: 'manual' | 'threshold' | 'overflow'
      readonly summaryCountAtStart: number
      readonly timeline: readonly AgentCompactionTimelineItem[]
      readonly suppressAnnouncement?: boolean
    }
  | {
      readonly type: 'retrying'
      readonly attempt: number
      readonly maxAttempts: number
      readonly delayMs: number
      readonly errorMessage: string
      readonly previousCompactionStatus: Exclude<
        AgentCompactionStatus,
        { readonly type: 'retrying' }
      > | null
    }

type TimelineCompactionStatus = Exclude<AgentCompactionStatus, { readonly type: 'retrying' }>

export function getTimelineCompactionStatus(
  status: AgentCompactionStatus | null,
): TimelineCompactionStatus | null {
  return status?.type === 'retrying' ? status.previousCompactionStatus : status
}

export function isCompactionRunning(status: AgentCompactionStatus | null) {
  return getTimelineCompactionStatus(status)?.timeline.at(-1)?.phase === 'running'
}

function statusFromTimeline(
  timeline: readonly AgentCompactionTimelineItem[],
  suppressAnnouncement = false,
): TimelineCompactionStatus | null {
  const latest = timeline.at(-1)
  if (!latest) return null
  return {
    type: latest.phase === 'running' ? 'compacting' : 'completed',
    reason: latest.reason,
    summaryCountAtStart: latest.summaryCountAtStart,
    timeline,
    ...(suppressAnnouncement ? { suppressAnnouncement: true } : {}),
  }
}

export function withoutLatestRunningCompaction(
  status: AgentCompactionStatus | null,
): TimelineCompactionStatus | null {
  const timelineStatus = getTimelineCompactionStatus(status)
  if (!timelineStatus) return null
  const timeline =
    timelineStatus.timeline.at(-1)?.phase === 'running'
      ? timelineStatus.timeline.slice(0, -1)
      : timelineStatus.timeline
  return statusFromTimeline(timeline, true)
}

export function acknowledgeCompactionStatus(
  status: AgentCompactionStatus | null,
  durableSummaryIds: readonly string[],
): AgentCompactionStatus | null {
  if (!status) return null
  const timelineStatus = getTimelineCompactionStatus(status)
  if (!timelineStatus) return status
  const durableIds = new Set(durableSummaryIds)
  const latestMatchedIndex = timelineStatus.timeline.reduce(
    (matchedIndex, item, index) =>
      item.expectedSummaryId && durableIds.has(item.expectedSummaryId) ? index : matchedIndex,
    -1,
  )
  const timeline = timelineStatus.timeline.filter((item, index) => {
    if (item.phase === 'running') return true
    if (index <= latestMatchedIndex) return false
    if (item.expectedSummaryId) return true
    return durableSummaryIds.length < (item.expectedSummaryCount ?? item.summaryCountAtStart + 1)
  })
  const acknowledged = statusFromTimeline(timeline, timelineStatus.suppressAnnouncement)
  return status.type === 'retrying'
    ? { ...status, previousCompactionStatus: acknowledged }
    : acknowledged
}

export function compactionResultEntryId(result: unknown) {
  if (typeof result !== 'object' || result === null || Array.isArray(result)) return undefined
  const entryId = 'entryId' in result ? result.entryId : undefined
  return typeof entryId === 'string' ? entryId : undefined
}
