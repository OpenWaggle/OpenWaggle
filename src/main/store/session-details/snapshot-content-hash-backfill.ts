import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import type { PersistSessionSnapshotInput } from '../../ports/session-repository'

/** Rows one statement stores the digests of. */
const CONTENT_HASH_BACKFILL_BATCH = 500

/**
 * Stores the digests of rows stored before digests existed whose content the snapshot left as it
 * was, so the Session's next snapshot compares them by digest (D6), in batches of one statement:
 * the first snapshot after the upgrade does this for every row of the Session. Only the digest
 * changes: no search or export trigger runs for it, and the node-mutation revision does not move
 * (migration 85 limits that trigger to the columns a reader sees).
 */
export function backfillContentHashes(
  sql: SqlClient.SqlClient,
  sessionId: PersistSessionSnapshotInput['sessionId'],
  digestByNodeId: readonly (readonly [nodeId: string, contentHash: string])[],
  slice: Effect.Effect<void>,
) {
  return Effect.gen(function* () {
    for (let start = 0; start < digestByNodeId.length; start += CONTENT_HASH_BACKFILL_BATCH) {
      const batch = digestByNodeId.slice(start, start + CONTENT_HASH_BACKFILL_BATCH)
      // `+` keeps the planner off the session index: it looks each row up by id instead of
      // scanning the batch once per node of the Session.
      yield* sql`
        UPDATE session_nodes SET content_hash = json_extract(backfill.value, '$[1]')
        FROM json_each(${JSON.stringify(batch)}) AS backfill
        WHERE session_nodes.id = json_extract(backfill.value, '$[0]')
          AND +session_nodes.session_id = ${sessionId}
          AND session_nodes.content_hash IS NULL
      `
      yield* slice
    }
  })
}
