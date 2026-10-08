import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import type { PersistSessionSnapshotInput } from '../../ports/session-repository'

/** A snapshot node whose id another Session's projection already holds. */
export interface SessionNodeIdConflict {
  readonly nodeId: string
  readonly ownerSessionId: string
}

/** Conflicts named in a message or log line; the rest are counted. */
export const MAX_NAMED_CONFLICTS = 10

/**
 * A snapshot that cannot be saved because some of its node ids belong to other Sessions.
 *
 * `session_nodes` is keyed by node id alone, and node ids are Pi entry ids, which Pi only keeps
 * unique within one session file. The message names each id and its owner, because SQLite's own
 * `UNIQUE constraint failed: session_nodes.id` names neither.
 */
export class SessionNodeIdConflictError extends Error {
  readonly sessionId: string
  readonly conflicts: readonly SessionNodeIdConflict[]

  constructor(sessionId: string, conflicts: readonly SessionNodeIdConflict[]) {
    const named = conflicts.slice(0, MAX_NAMED_CONFLICTS)
    const more = conflicts.length - named.length
    super(
      `Session ${sessionId} snapshot reuses node ids owned by other Sessions: ${named
        .map((conflict) => `${conflict.nodeId} (Session ${conflict.ownerSessionId})`)
        .join(', ')}${more > 0 ? ` and ${more} more` : ''}`,
    )
    this.name = 'SessionNodeIdConflictError'
    this.sessionId = sessionId
    this.conflicts = conflicts
  }
}

export function findSessionNodeIdConflictsWithSql(
  sql: SqlClient.SqlClient,
  sessionId: PersistSessionSnapshotInput['sessionId'],
  nodeIds: readonly string[],
) {
  return Effect.gen(function* () {
    if (nodeIds.length === 0) return []
    const rows = yield* sql<{ readonly id: string; readonly session_id: string }>`
      SELECT id, session_id
      FROM session_nodes
      WHERE session_id != ${sessionId}
        AND id IN (SELECT CAST(value AS TEXT) FROM json_each(${JSON.stringify(nodeIds)}))
      ORDER BY id
    `
    return rows.map(
      (row): SessionNodeIdConflict => ({ nodeId: row.id, ownerSessionId: row.session_id }),
    )
  })
}

/** Fails with {@link SessionNodeIdConflictError} when a snapshot node id belongs to another Session. */
export function assertNoSessionNodeIdConflicts(
  sql: SqlClient.SqlClient,
  sessionId: PersistSessionSnapshotInput['sessionId'],
  nodeIds: readonly string[],
) {
  return Effect.gen(function* () {
    const conflicts = yield* findSessionNodeIdConflictsWithSql(sql, sessionId, nodeIds)
    if (conflicts.length > 0) {
      return yield* Effect.fail(new SessionNodeIdConflictError(String(sessionId), conflicts))
    }
  })
}
