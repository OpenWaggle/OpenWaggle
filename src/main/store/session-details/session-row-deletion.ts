import type * as SqlClient from '@effect/sql/SqlClient'
import type { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { SESSION_LEXICAL_DISCOVERY_DEFERRAL_TABLE } from '../../services/session-host-discovery-search-schema'
import { yieldToEventLoop } from '../../utils/event-loop-slice'

/** Nodes one step of a Session deletion detaches and deletes. */
export const SESSION_DELETION_NODE_CHUNK = 500

function deleteNodeChunk(sql: SqlClient.SqlClient, id: SessionId, chunk: number) {
  return Effect.gen(function* () {
    const rows = yield* sql<{ readonly id: string }>`
      SELECT id FROM session_nodes
      WHERE session_id = ${id}
      ORDER BY created_order DESC, id DESC
      LIMIT ${chunk}
    `
    if (rows.length === 0) return 0
    const ids = JSON.stringify(rows.map((row) => row.id))
    // Detached first, so no parent cascade nests a trigger per remaining turn.
    yield* sql`
      UPDATE session_nodes SET parent_id = NULL
      WHERE parent_id IN (SELECT value FROM json_each(${ids}))
        OR (id IN (SELECT value FROM json_each(${ids})) AND parent_id IS NOT NULL)
    `
    yield* sql`DELETE FROM session_nodes WHERE id IN (SELECT value FROM json_each(${ids}))`
    return rows.length
  })
}

/** Term rows one step of a Session deletion removes, before the Session row cascades the rest. */
const SESSION_DELETION_TERM_CHUNK = 2_000

function deleteTermChunk(sql: SqlClient.SqlClient, id: SessionId) {
  return Effect.map(
    sql<{ readonly term: string }>`
      DELETE FROM session_transcript_terms
      WHERE session_id = ${id} AND term IN (
        SELECT term FROM session_transcript_terms WHERE session_id = ${id}
        LIMIT ${SESSION_DELETION_TERM_CHUNK}
      )
      RETURNING term
    `,
    (rows) => rows.length,
  )
}

/**
 * Deletes a Session row and, through its cascades, everything it owns. Run it inside the caller's
 * transaction or savepoint, so a refused delete restores everything.
 *
 * Each node's `parent_id` cascade runs as a nested trigger, so deleting a linear transcript
 * recursed once per turn, and SQLite refuses past 1000 levels ("too many levels of trigger
 * recursion"). Nodes are now detached and deleted in chunks of `SESSION_DELETION_NODE_CHUNK`,
 * newest first, with the event loop running between chunks: a 3,600-node Session took two
 * statements of 290 and 350 ms, now chunks of at most ~35 ms (190 ms in total). The node triggers'
 * lexical discovery rebuild is suspended for the Session, which disappears at the end anyway.
 *
 * The Session's branches go first: they name its nodes without a cascade (`head_node_id`,
 * `source_node_id`), and the Session delete would remove them with their cascades anyway. Every
 * statement still checks its foreign keys immediately, so a deletion something else depends on
 * fails at the statement that would break it, as before.
 */
export function deleteSessionRow(
  sql: SqlClient.SqlClient,
  id: SessionId,
  options: { readonly chunk?: number; readonly betweenChunks?: Effect.Effect<void> } = {},
) {
  const chunk = options.chunk ?? SESSION_DELETION_NODE_CHUNK
  const betweenChunks = options.betweenChunks ?? yieldToEventLoop
  return Effect.gen(function* () {
    yield* sql.unsafe(
      `INSERT INTO ${SESSION_LEXICAL_DISCOVERY_DEFERRAL_TABLE} (session_id) VALUES (?)
       ON CONFLICT(session_id) DO NOTHING`,
      [id],
    )
    yield* sql`DELETE FROM session_branches WHERE session_id = ${id}`
    while ((yield* deleteNodeChunk(sql, id, chunk)) === chunk) yield* betweenChunks
    // Its term index is its largest cascade (tens of thousands of rows for a long Session).
    while ((yield* deleteTermChunk(sql, id)) === SESSION_DELETION_TERM_CHUNK) yield* betweenChunks
    yield* sql`DELETE FROM sessions WHERE id = ${id}`
    yield* sql.unsafe(
      `DELETE FROM ${SESSION_LEXICAL_DISCOVERY_DEFERRAL_TABLE} WHERE session_id = ?`,
      [id],
    )
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
