import type { SessionId } from '@shared/types/brand'
import { withUnannouncedRunNotice } from './background-run-active-state'
import type { RenderSnapshotState, RunRenderSnapshot } from './background-run-render-state'
import { isUnnamedRunSeed, UNNAMED_RUN_SEED } from './background-run-seed'
import { seededSnapshotForRunStart } from './background-run-started-run'
import { withRenderSnapshot } from './background-run-snapshot-map'

/*
 * The render snapshot of a Run the renderer learned of only from what it streamed: its
 * `agent_start` never arrived (a resync lost it).
 */

/**
 * A Run streams in a Session this renderer holds no Run for: its `agent_start` never arrived (a
 * resync lost it). The notice makes the chat showing it hydrate it again as running, from its
 * reconnect buffer; it otherwise showed the Session idle, and empty, until the Run settled.
 *
 * With no snapshot, or one holding the settled Run before, its answers get a snapshot of their
 * own, as at an unnamed start: mid-Run only that snapshot keeps the answers the buffer's history
 * budget drops. A snapshot whose Run ended unsettled takes them after that Run's
 * (`withUnannouncedRunAfter`).
 */
export function withUnannouncedRunNoticed(
  state: RenderSnapshotState & { readonly unannouncedRunNotices: Map<SessionId, number> },
  id: SessionId,
  startedAt: number,
) {
  const existing = state.renderSnapshotsBySessionId.get(id)
  const snapshot =
    existing === undefined || existing.settledRunId !== undefined
      ? seededSnapshotForRunStart(existing, UNNAMED_RUN_SEED, startedAt)
      : withUnannouncedRunAfter(existing)
  return { ...withRenderSnapshot(state, id, snapshot), ...withUnannouncedRunNotice(state, id) }
}

/**
 * The Run ended unsettled holds the snapshot. A named one's rows are noticed, set apart only once
 * the noticed Run is known to be another (`withNoticeResolved`): Pi may be continuing that Run,
 * whose answers are unsaved still. Rows of a Run known by no name are set apart now, and the Run
 * streaming is named by its end or late start, as the bridge's unnamed start is: an unnamed seed,
 * or in a route's snapshot an unnamed start, which a retry's real start names.
 */
function withUnannouncedRunAfter(existing: RunRenderSnapshot) {
  const shownIds = new Set(existing.messages.map((message) => message.id))
  // A named Run's rows wait for the noticed Run to be named: Pi may be continuing that Run.
  const held = existing.seededByRunId ?? existing.startedRun?.runId
  if (held !== undefined && !isUnnamedRunSeed(held)) {
    return { ...existing, noticedMessageIds: shownIds }
  }
  const settledMessageIds = new Set([...(existing.settledMessageIds ?? []), ...shownIds])
  return existing.seededByRunId === undefined
    ? {
        ...existing,
        startedRun: { runId: UNNAMED_RUN_SEED, earlierMessageIds: shownIds },
        settledMessageIds,
      }
    : { ...existing, seededByRunId: UNNAMED_RUN_SEED, settledMessageIds }
}
