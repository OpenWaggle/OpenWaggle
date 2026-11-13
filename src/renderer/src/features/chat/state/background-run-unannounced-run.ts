import type { SessionId } from '@shared/types/brand'
import {
  isUnnamedRunSeed,
  type RenderSnapshotState,
  type RunRenderSnapshot,
  UNNAMED_RUN_SEED,
} from './background-run-render-state'
import { seededSnapshotForRunStart } from './background-run-started-run'

/*
 * The render snapshot of a Run the renderer learned of only from what it streamed: its
 * `agent_start` never arrived (a resync lost it).
 */

/**
 * A Run whose start was lost streams (`noteUnannouncedRun`). With no snapshot, or one holding the
 * settled Run before, its answers get a snapshot of their own, as at an unnamed start: mid-Run
 * only that snapshot keeps the answers the buffer's history budget drops. A snapshot whose Run
 * ended unsettled takes them after that Run's (`withUnannouncedRunAfter`).
 */
export function withUnannouncedRunRenderSnapshot(
  state: RenderSnapshotState,
  id: SessionId,
  startedAt: number,
) {
  const existing = state.renderSnapshotsBySessionId.get(id)
  const snapshot =
    existing === undefined || existing.settledRunId !== undefined
      ? seededSnapshotForRunStart(existing, UNNAMED_RUN_SEED, startedAt)
      : withUnannouncedRunAfter(existing)
  return { renderSnapshotsBySessionId: new Map(state.renderSnapshotsBySessionId).set(id, snapshot) }
}

/**
 * The Run ended unsettled holds the snapshot. A named one's rows are noticed, set apart only once
 * the noticed Run is known to be another (`withNoticeResolved`): Pi may be continuing that Run,
 * whose answers are unsaved still. Rows of a Run known by no name are set apart now, and the Run
 * streaming is named by its end or late start, as the bridge's unnamed start is: an unnamed seed,
 * or in a route's snapshot an unnamed start, which a retry's real start names.
 */
function withUnannouncedRunAfter(existing: RunRenderSnapshot): RunRenderSnapshot {
  // A named Run's rows wait for the noticed Run to be named: Pi may be continuing that Run.
  const held = existing.seededByRunId ?? existing.startedRun?.runId
  if (held !== undefined && !isUnnamedRunSeed(held)) {
    const noticedMessageIds = new Set(existing.messages.map((message) => message.id))
    return { ...existing, noticedMessageIds }
  }
  const earlierMessageIds = new Set(existing.messages.map((message) => message.id))
  const settledMessageIds = new Set([...(existing.settledMessageIds ?? []), ...earlierMessageIds])
  return existing.seededByRunId === undefined
    ? { ...existing, startedRun: { runId: UNNAMED_RUN_SEED, earlierMessageIds }, settledMessageIds }
    : { ...existing, seededByRunId: UNNAMED_RUN_SEED, settledMessageIds }
}
