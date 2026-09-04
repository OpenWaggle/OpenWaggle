import type {
  ActiveAgentRunInfo,
  ActiveCompactionInfo,
  ActiveRunInfo,
} from '@shared/types/background-run'
import type { SessionId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { AgentCompactionStatus } from '@/features/chat/lib/compaction-lifecycle'
import { applyCompactionSnapshotEvent } from './background-run-compaction'

interface RunRenderSnapshot {
  readonly messages: readonly UIMessage[]
  readonly compactionStatus: AgentCompactionStatus | null
  readonly updatedAt: number
}

interface RunRenderState {
  readonly renderSnapshotsBySessionId: ReadonlyMap<SessionId, RunRenderSnapshot>
}

const activityRevisions = new Map<SessionId, number>()

export function noteActivityLifecycleChange(sessionId: SessionId) {
  activityRevisions.set(sessionId, (activityRevisions.get(sessionId) ?? 0) + 1)
}

export function captureActivityRevisions() {
  return new Map(activityRevisions)
}

function activityUnchangedSince(
  sessionId: SessionId,
  capturedRevisions: ReadonlyMap<SessionId, number>,
) {
  return (activityRevisions.get(sessionId) ?? 0) === (capturedRevisions.get(sessionId) ?? 0)
}

export function retainUnchangedActivities(
  ids: ReadonlySet<SessionId>,
  compactions: readonly ActiveCompactionInfo[],
  runs: readonly ActiveAgentRunInfo[],
  capturedRevisions: ReadonlyMap<SessionId, number>,
) {
  return {
    ids: new Set([...ids].filter((id) => activityUnchangedSince(id, capturedRevisions))),
    compactions: compactions.filter((compaction) =>
      activityUnchangedSince(compaction.sessionId, capturedRevisions),
    ),
    runs: runs.filter((run) => activityUnchangedSince(run.sessionId, capturedRevisions)),
  }
}

export function isAgentRun(activity: ActiveRunInfo): activity is ActiveAgentRunInfo {
  return activity.activity === 'agent-run'
}

export function isActiveCompaction(activity: ActiveRunInfo): activity is ActiveCompactionInfo {
  return activity.activity === 'compaction'
}

export function restoreCompactionSnapshots(
  state: RunRenderState,
  compactions: readonly ActiveCompactionInfo[],
  runs: readonly ActiveAgentRunInfo[],
) {
  const snapshots = new Map(state.renderSnapshotsBySessionId)
  for (const compaction of compactions) {
    if (snapshots.has(compaction.sessionId)) continue
    const messages: readonly UIMessage[] = []
    snapshots.set(compaction.sessionId, {
      messages,
      compactionStatus: applyCompactionSnapshotEvent(
        null,
        {
          type: 'compaction_start',
          reason: compaction.reason,
          timestamp: compaction.startedAt,
        },
        messages,
      ),
      updatedAt: Date.now(),
    })
  }
  for (const run of runs) {
    const activityEvents = run.activityEvents ?? []
    if (snapshots.has(run.sessionId) || activityEvents.length === 0) continue
    const messages: readonly UIMessage[] = []
    const compactionStatus = activityEvents.reduce<AgentCompactionStatus | null>(
      (status, event) => applyCompactionSnapshotEvent(status, event, messages),
      null,
    )
    if (compactionStatus === null) continue
    snapshots.set(run.sessionId, {
      messages,
      compactionStatus,
      updatedAt: activityEvents.at(-1)?.timestamp ?? run.startedAt,
    })
  }
  return snapshots
}
