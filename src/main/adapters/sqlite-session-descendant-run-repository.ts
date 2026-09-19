import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { SessionControlRepositoryError } from '../errors'
import { SessionDescendantRunRepository } from '../ports/session-descendant-run-repository'

interface ActiveDescendantRunRow {
  readonly session_id: string
  readonly run_id: string
  readonly depth: number
}

export const SqliteSessionDescendantRunRepositoryLive = Layer.effect(
  SessionDescendantRunRepository,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return SessionDescendantRunRepository.of({
      listActive: ({ ancestorSessionId }) =>
        sql<ActiveDescendantRunRow>`
          WITH RECURSIVE descendants(session_id, depth) AS (
            SELECT child_session_id, 1
            FROM session_spawn_lineage
            WHERE parent_session_id = ${ancestorSessionId}
            UNION ALL
            SELECT lineage.child_session_id, descendants.depth + 1
            FROM session_spawn_lineage AS lineage
            JOIN descendants ON lineage.parent_session_id = descendants.session_id
          )
          SELECT descendants.session_id, states.active_run_id AS run_id, descendants.depth
          FROM descendants
          JOIN session_control_states AS states ON states.session_id = descendants.session_id
          JOIN session_runs AS runs
            ON runs.id = states.active_run_id AND runs.session_id = descendants.session_id
          WHERE runs.status IN ('starting', 'active')
          ORDER BY descendants.depth DESC, descendants.session_id ASC
        `.pipe(
          Effect.map((rows) =>
            rows.map((row) => ({
              sessionId: row.session_id,
              runId: row.run_id,
              depth: row.depth,
            })),
          ),
          Effect.mapError(
            (cause) =>
              new SessionControlRepositoryError({
                operation: 'list-active-descendant-runs',
                cause,
              }),
          ),
        ),
    })
  }),
)
