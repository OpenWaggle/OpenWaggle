import type * as SqlClient from '@effect/sql/SqlClient'
import type { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { EMPTY_INDEX } from './constants'
import { assertSessionDeleteSatisfiesForeignKeys } from './session-row-deletion'

export function assertSessionHasNoForks(sql: SqlClient.SqlClient, id: SessionId) {
  return Effect.gen(function* () {
    const rows = yield* sql<{ readonly derived_session_id: string }>`
      SELECT derived_session_id
      FROM session_derivations
      WHERE source_session_id = ${id}
      ORDER BY created_at, derived_session_id
      LIMIT 1
    `
    const fork = rows[EMPTY_INDEX]
    if (fork) {
      throw new Error(
        `Session deletion was refused because fork ${fork.derived_session_id} still depends on it.`,
      )
    }
  })
}

export function assertSessionHasNoWorkers(sql: SqlClient.SqlClient, id: SessionId) {
  return Effect.gen(function* () {
    const rows = yield* sql<{ readonly child_session_id: string }>`
      SELECT child_session_id FROM (
        SELECT child_session_id, created_at
        FROM session_spawn_lineage
        WHERE parent_session_id = ${id} OR hive_root_session_id = ${id}
        UNION ALL
        SELECT session_id AS child_session_id, created_at
        FROM session_lineage
        WHERE parent_session_id = ${id}
      )
      ORDER BY created_at, child_session_id
      LIMIT 1
    `
    const worker = rows[EMPTY_INDEX]
    if (worker) {
      throw new Error(
        `Session deletion was refused because worker ${worker.child_session_id} still depends on it.`,
      )
    }
  })
}

/**
 * Refuses a Session deletion that would break what depends on the Session: its forks, its Hive
 * Workers, or any other durable row a foreign key ties to it.
 */
export function assertSessionDeletable(sql: SqlClient.SqlClient, id: SessionId) {
  return Effect.gen(function* () {
    yield* assertSessionHasNoForks(sql, id)
    yield* assertSessionHasNoWorkers(sql, id)
    yield* assertSessionDeleteSatisfiesForeignKeys(sql, id)
  })
}
