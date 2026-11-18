import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import {
  refreshSessionLexicalDiscoveryStatements,
  SESSION_LEXICAL_DISCOVERY_DEFERRAL_TABLE,
} from '../../services/session-host-discovery-search-schema'

const SESSION_ID_PARAMETER = '?'
const REFRESH_STATEMENTS = refreshSessionLexicalDiscoveryStatements(SESSION_ID_PARAMETER)

function parameterCount(statement: string) {
  return statement.split(SESSION_ID_PARAMETER).length - 1
}

function refreshLexicalDiscovery(sql: SqlClient.SqlClient, sessionId: string) {
  return Effect.forEach(
    REFRESH_STATEMENTS,
    (statement) =>
      sql.unsafe(
        statement,
        Array.from({ length: parameterCount(statement) }, () => sessionId),
      ),
    { discard: true },
  )
}

function releaseDeferral(sql: SqlClient.SqlClient, sessionId: string) {
  return sql.unsafe(
    `DELETE FROM ${SESSION_LEXICAL_DISCOVERY_DEFERRAL_TABLE} WHERE session_id = ?`,
    [sessionId],
  )
}

/**
 * Runs a bulk node write for one Session with the node triggers' lexical discovery rebuild
 * suspended, then rebuilds the discovery row once (#357).
 *
 * Each rebuild replaces the row and its term postings, so a Run's snapshot paid it once per
 * written node: 2.5 s for a 268-node Worker on a 2 GB database, all of it blocking the Host.
 * The row only depends on the final nodes. Must run inside the write's transaction: a rollback
 * then also removes the deferral, and no other writer can see it.
 */
export function withDeferredLexicalDiscoveryRefresh<A, E, R>(
  sql: SqlClient.SqlClient,
  sessionId: string,
  write: Effect.Effect<A, E, R>,
) {
  return Effect.acquireUseRelease(
    sql.unsafe(
      `INSERT INTO ${SESSION_LEXICAL_DISCOVERY_DEFERRAL_TABLE} (session_id) VALUES (?)
       ON CONFLICT(session_id) DO NOTHING`,
      [sessionId],
    ),
    () =>
      Effect.tap(write, () =>
        Effect.zipRight(releaseDeferral(sql, sessionId), refreshLexicalDiscovery(sql, sessionId)),
      ),
    () => releaseDeferral(sql, sessionId).pipe(Effect.ignore),
  )
}
