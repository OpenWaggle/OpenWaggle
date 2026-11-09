import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { SessionControlRepositoryError } from '../errors'
import type { SessionSelfArchiveState } from '../ports/session-organization-repository'

interface SelfArchiveStateRow {
  readonly archived: number
  readonly active_run_id: string | null
  readonly queued_follow_up_count: number
  readonly run_status: string | null
  readonly later_run_count: number
}

export function readSessionSelfArchiveState(
  sql: SqlClient.SqlClient,
  input: { readonly sessionId: string; readonly runId: string },
) {
  return sql<SelfArchiveStateRow>`
    SELECT sessions.archived, session_control_states.active_run_id,
      (SELECT COUNT(*) FROM session_follow_ups
        WHERE session_follow_ups.session_id = sessions.id) AS queued_follow_up_count,
      (SELECT status FROM session_runs
        WHERE session_runs.id = ${input.runId} AND session_runs.session_id = sessions.id)
        AS run_status,
      (SELECT COUNT(*) FROM session_runs AS later
        JOIN session_runs AS asking
          ON asking.id = ${input.runId} AND asking.session_id = sessions.id
        WHERE later.session_id = sessions.id AND later.rowid > asking.rowid) AS later_run_count
    FROM sessions
    LEFT JOIN session_control_states ON session_control_states.session_id = sessions.id
    WHERE sessions.id = ${input.sessionId}
    LIMIT 1
  `.pipe(
    Effect.map((rows): SessionSelfArchiveState | null => {
      const row = rows[0]
      if (!row) return null
      return {
        archived: row.archived === 1,
        activeRunId: row.active_run_id,
        queuedFollowUpCount: row.queued_follow_up_count,
        runStatus: row.run_status,
        laterRunCount: row.later_run_count,
      }
    }),
    Effect.mapError(
      (cause) => new SessionControlRepositoryError({ operation: 'read-self-archive-state', cause }),
    ),
  )
}
