/**
 * The run id `session-host-renderer-bridge` gives the `agent_start` it synthesizes for a Run a
 * reconnected Host already had in progress. It names no Run, so it cannot tell a retry of that Run
 * from the next one.
 */
const REMOTE_SNAPSHOT_RUN_ID_PREFIX = 'remote-snapshot:'

/** A snapshot of the in-progress Run whose start the renderer never saw (compaction, restore). */
export const UNNAMED_RUN_SEED = 'unnamed-run'

/** Whether a seed's Run is in progress but its real id is not known yet. */
export function isUnnamedRunSeed(runId: string | undefined) {
  return runId === UNNAMED_RUN_SEED || runId?.startsWith(REMOTE_SNAPSHOT_RUN_ID_PREFIX) === true
}
