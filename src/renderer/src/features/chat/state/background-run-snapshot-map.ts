import type { SessionId } from '@shared/types/brand'
import type { RenderSnapshotState, RunRenderSnapshot } from './background-run-render-state'

/** The render snapshots with the Session's replaced by `snapshot`. */
export function withRenderSnapshot(
  state: RenderSnapshotState,
  id: SessionId,
  snapshot: RunRenderSnapshot,
) {
  return { renderSnapshotsBySessionId: new Map(state.renderSnapshotsBySessionId).set(id, snapshot) }
}
