import type {
  ActiveAgentRunInfo,
  ActiveCompactionInfo,
  ActiveRunInfo,
} from '@shared/types/background-run'
import type { SessionId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { AgentCompactionStatus } from '@/features/chat/lib/compaction-lifecycle'
import { api } from '@/shared/lib/ipc'
import { applyCompactionSnapshotEvent } from './background-run-compaction'
import { type RunRenderSnapshot, UNNAMED_RUN_SEED } from './background-run-render-state'

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

/**
 * Snapshots for activities in progress when the renderer started: empty, holding only the activity's
 * compaction status, and seeded for the Run whose start the renderer never saw. Opening the Session
 * then places that status after its persisted history.
 */
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
      seededByRunId: UNNAMED_RUN_SEED,
    })
  }
  for (const run of runs) {
    const restored = restoredRunSnapshot(run, snapshots.get(run.sessionId))
    if (restored) snapshots.set(run.sessionId, restored)
  }
  return snapshots
}

/**
 * A restored Run's compaction status, in a snapshot of its own or in the one it seeded streaming
 * before the restore landed (its start unseen); `null` when the Run has none or a snapshot exists.
 */
function restoredRunSnapshot(
  run: ActiveAgentRunInfo,
  existing: RunRenderSnapshot | undefined,
): RunRenderSnapshot | null {
  const activityEvents = run.activityEvents ?? []
  const unannounced = existing?.seededByRunId === UNNAMED_RUN_SEED && !existing.compactionStatus
  if ((existing && !unannounced) || activityEvents.length === 0) return null
  // The compaction came before what the snapshot streamed: its status stands before it.
  const messages: readonly UIMessage[] = []
  const compactionStatus = activityEvents.reduce<AgentCompactionStatus | null>(
    (status, event) => applyCompactionSnapshotEvent(status, event, messages),
    null,
  )
  if (compactionStatus === null) return null
  return {
    ...existing,
    messages: existing?.messages ?? messages,
    compactionStatus,
    updatedAt: activityEvents.at(-1)?.timestamp ?? run.startedAt,
    seededByRunId: UNNAMED_RUN_SEED,
  }
}

/** The Run each Session had in progress when this renderer last restored activity, by its id. */
const restoredRunIds = new Map<SessionId, string>()

/**
 * The Run a Session had in progress when the renderer started, whose start it never saw; taken
 * once, by the next start or settlement of a Run in that Session.
 */
export function takeRestoredRunId(sessionId: SessionId) {
  const runId = restoredRunIds.get(sessionId)
  restoredRunIds.delete(sessionId)
  return runId
}

export async function loadActiveActivityState() {
  const activities = await api.listActiveRuns()
  const runs = activities.filter(isAgentRun)
  const snapshots = await Promise.all(runs.map((run) => api.getBackgroundRun(run.sessionId)))
  restoredRunIds.clear()
  for (const snapshot of snapshots) {
    if (snapshot?.runId) restoredRunIds.set(snapshot.sessionId, snapshot.runId)
  }
  return {
    ids: new Set<SessionId>(activities.map((activity) => activity.sessionId)),
    runs,
    compactions: activities.filter(isActiveCompaction),
    snapshots,
  }
}
