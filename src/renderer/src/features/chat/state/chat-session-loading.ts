import type { SessionId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'

interface CurrentSessionSummaryState {
  readonly sessions: readonly SessionSummary[]
  readonly missingSessionIds: ReadonlySet<SessionId>
}

export function reconcileLoadedSummaries(
  loaded: readonly SessionSummary[],
  current: CurrentSessionSummaryState,
  changed: (id: SessionId) => boolean,
) {
  const summaryById = new Map<SessionId, SessionSummary>()
  for (const summary of loaded) {
    if (changed(summary.id) && current.missingSessionIds.has(summary.id)) continue
    summaryById.set(
      summary.id,
      changed(summary.id)
        ? (current.sessions.find((candidate) => candidate.id === summary.id) ?? summary)
        : summary,
    )
  }
  for (const summary of current.sessions) {
    if (changed(summary.id) && !current.missingSessionIds.has(summary.id)) {
      summaryById.set(summary.id, summary)
    }
  }
  return [...summaryById.values()]
}

export function visibleSummaries(summaries: readonly SessionSummary[]) {
  return summaries.filter(
    (summary) => summary.title !== 'New session' || (summary.messageCount ?? 0) > 0,
  )
}

export function reconcileMissingSessions(
  loaded: readonly SessionSummary[],
  current: CurrentSessionSummaryState,
  changed: (id: SessionId) => boolean,
) {
  const missingSessionIds = new Set(current.missingSessionIds)
  for (const session of loaded) {
    if (!changed(session.id)) missingSessionIds.delete(session.id)
  }
  return missingSessionIds
}
