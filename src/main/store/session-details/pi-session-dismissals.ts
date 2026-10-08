import { randomUUID } from 'node:crypto'
import type * as SqlClient from '@effect/sql/SqlClient'
import type { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { EMPTY_INDEX } from './constants'

/**
 * Deleting a Session discovered from another Pi program removes it from OpenWaggle only (ADR 0050):
 * its Pi file is the user's history in that program. The dismissal outlives the Session, so
 * discovery does not list the file again, and the Pi file cleanup leaves the file in place.
 */
export function dismissDiscoveredPiSession(sql: SqlClient.SqlClient, id: SessionId, now: number) {
  return sql`
    INSERT INTO pi_session_dismissals (pi_session_file, pi_session_id, dismissed_at)
    SELECT sessions.pi_session_file, sessions.pi_session_id, ${now}
    FROM sessions
    JOIN pi_session_adoptions ON pi_session_adoptions.session_id = sessions.id
    WHERE sessions.id = ${id} AND sessions.pi_session_file IS NOT NULL
    ON CONFLICT (pi_session_file) DO NOTHING
  `
}

function isDismissedPiSessionFile(sql: SqlClient.SqlClient, piSessionFile: string) {
  return Effect.map(
    sql<{ readonly dismissed: number }>`
      SELECT EXISTS (
        SELECT 1 FROM pi_session_dismissals WHERE pi_session_file = ${piSessionFile}
      ) AS dismissed
    `,
    (rows) => rows[EMPTY_INDEX]?.dismissed === 1,
  )
}

/**
 * A deletion that did not go ahead leaves the Session in place, so discovery may list its Pi file
 * again if the Session is deleted later. After a completed deletion the Session row is gone and
 * the dismissal stays.
 */
function undoPiSessionDismissal(sql: SqlClient.SqlClient, id: SessionId) {
  return sql`
    DELETE FROM pi_session_dismissals
    WHERE pi_session_file IN (
      SELECT sessions.pi_session_file FROM sessions
      JOIN pi_session_adoptions ON pi_session_adoptions.session_id = sessions.id
      WHERE sessions.id = ${id}
    )
  `
}

/**
 * Where Pi file cleanup moves the file before removing it, or null to leave it: a discovered Pi
 * session's file belongs to the program that made it and stays (ADR 0050).
 */
export function stagedPiSessionFile(sql: SqlClient.SqlClient, piSessionFile: string | null) {
  return Effect.gen(function* () {
    if (!piSessionFile || (yield* isDismissedPiSessionFile(sql, piSessionFile))) return null
    return `${piSessionFile}.${randomUUID()}.delete`
  })
}

/** Drops the deletion journal, after a completed deletion or one that did not go ahead. */
export function abandonSessionDeletionWithSql(sql: SqlClient.SqlClient, id: SessionId) {
  return sql.withTransaction(
    Effect.gen(function* () {
      yield* undoPiSessionDismissal(sql, id)
      yield* sql`DELETE FROM session_deletion_operations WHERE session_id = ${id}`
    }),
  )
}
