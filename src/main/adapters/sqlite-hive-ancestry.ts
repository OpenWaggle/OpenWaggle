import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { HiveAncestry, type HiveAncestryShape } from '../ports/hive-ancestry'

interface AncestorRow {
  readonly session_id: string
}

function makeHiveAncestry(sql: SqlClient.SqlClient) {
  return {
    ancestorsOf: (sessionId) =>
      sql<AncestorRow>`
        WITH RECURSIVE ancestors(session_id, distance) AS (
          SELECT parent_session_id, 1 FROM session_spawn_lineage
          WHERE child_session_id = ${sessionId}
          UNION ALL
          SELECT lineage.parent_session_id, ancestors.distance + 1
          FROM session_spawn_lineage AS lineage
          JOIN ancestors ON lineage.child_session_id = ancestors.session_id
        )
        SELECT session_id FROM ancestors ORDER BY distance ASC
      `.pipe(
        Effect.map((rows) => rows.map((row) => row.session_id)),
        Effect.mapError(
          (cause) => new Error('Could not read the Hive ancestors of a Session.', { cause }),
        ),
      ),
  } satisfies HiveAncestryShape
}

export const SqliteHiveAncestryLive = Layer.effect(
  HiveAncestry,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return makeHiveAncestry(sql)
  }),
)
