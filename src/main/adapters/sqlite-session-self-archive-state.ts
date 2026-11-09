import type * as SqlClient from '@effect/sql/SqlClient'
import type { SessionLatestRunSummary } from '@shared/types/session'
import * as Effect from 'effect/Effect'
import { SessionControlRepositoryError } from '../errors'
import type { SessionSelfArchiveState } from '../ports/session-organization-repository'

const RUN_STATUSES: ReadonlySet<string> = new Set<SessionLatestRunSummary['status']>([
  'starting',
  'active',
  'stopping',
  'completed',
  'failed',
  'interrupted',
  'interrupted-by-host-loss',
  'interrupted-by-interaction-timeout',
])

function isRunStatus(value: string): value is SessionLatestRunSummary['status'] {
  return RUN_STATUSES.has(value)
}

function decodeRunStatus(value: string | null) {
  if (value === null) return null
  if (isRunStatus(value)) return value
  throw new Error(`Unknown Session Run status: ${value}`)
}

interface SelfArchiveStateRow {
  readonly archived: number
  readonly active_run_id: string | null
  readonly queued_follow_up_count: number
  readonly run_status: string | null
  readonly later_run_count: number
  readonly pending_worker_update_count: number
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
        WHERE later.session_id = sessions.id AND later.rowid > asking.rowid) AS later_run_count,
      (SELECT COUNT(*) FROM session_orchestration_updates AS updates
        WHERE updates.parent_session_id = sessions.id AND updates.status = ${'pending'})
        AS pending_worker_update_count
    FROM sessions
    LEFT JOIN session_control_states ON session_control_states.session_id = sessions.id
    WHERE sessions.id = ${input.sessionId}
    LIMIT 1
  `.pipe(
    Effect.flatMap((rows) =>
      Effect.try((): SessionSelfArchiveState | null => {
        const row = rows[0]
        if (!row) return null
        return {
          archived: row.archived === 1,
          activeRunId: row.active_run_id,
          queuedFollowUpCount: row.queued_follow_up_count,
          runStatus: decodeRunStatus(row.run_status),
          laterRunCount: row.later_run_count,
          pendingWorkerUpdateCount: row.pending_worker_update_count,
        }
      }),
    ),
    Effect.mapError(
      (cause) => new SessionControlRepositoryError({ operation: 'read-self-archive-state', cause }),
    ),
  )
}
