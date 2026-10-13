import type * as SqlClient from '@effect/sql/SqlClient'
import type { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'

/**
 * Deletes a Session row and, through its cascades, everything it owns.
 *
 * Each node's `parent_id` cascade runs as a nested trigger, so deleting a linear transcript
 * recursed once per turn, and SQLite refuses past 1000 levels ("too many levels of trigger
 * recursion"): a Session longer than about 1000 turns could not be deleted. With every node
 * detached from its parent first, each one is deleted one level deep. Run it inside the caller's
 * transaction or savepoint, so a refused delete restores the links.
 */
export function deleteSessionRow(sql: SqlClient.SqlClient, id: SessionId) {
  return Effect.gen(function* () {
    yield* sql`
      UPDATE session_nodes SET parent_id = NULL
      WHERE session_id = ${id} AND parent_id IS NOT NULL
    `
    yield* sql`DELETE FROM sessions WHERE id = ${id}`
  })
}

/** Refuses a deletion its foreign keys would refuse, by trying it and rolling it back. */
export function assertSessionDeleteSatisfiesForeignKeys(sql: SqlClient.SqlClient, id: SessionId) {
  return Effect.gen(function* () {
    yield* sql.unsafe('SAVEPOINT session_deletion_preflight')
    const deletion = yield* Effect.either(deleteSessionRow(sql, id))
    yield* sql.unsafe('ROLLBACK TO SAVEPOINT session_deletion_preflight')
    yield* sql.unsafe('RELEASE SAVEPOINT session_deletion_preflight')
    if (deletion._tag === 'Left') {
      throw new Error(
        'Session deletion was refused because related durable state still depends on it.',
        { cause: deletion.left },
      )
    }
  })
}
