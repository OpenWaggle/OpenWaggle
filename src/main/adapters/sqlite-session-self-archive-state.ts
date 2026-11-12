import type * as SqlClient from '@effect/sql/SqlClient'
import type { SessionLatestRunSummary } from '@shared/types/session'
import * as Effect from 'effect/Effect'
import { SessionControlRepositoryError } from '../errors'

/** Every Run status, as an object so a status added to the union must be listed here too. */
const RUN_STATUSES: Readonly<Record<SessionLatestRunSummary['status'], true>> = {
  starting: true,
  active: true,
  stopping: true,
  completed: true,
  failed: true,
  interrupted: true,
  'interrupted-by-host-loss': true,
  'interrupted-by-interaction-timeout': true,
}

function isRunStatus(value: string): value is SessionLatestRunSummary['status'] {
  return Object.hasOwn(RUN_STATUSES, value)
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
  readonly pinned: number
  readonly working_delegation_count: number
}

export function readSessionSelfArchiveState(
  sql: SqlClient.SqlClient,
  input: { readonly sessionId: string; readonly runId: string },
) {
  return sql<SelfArchiveStateRow>`
    SELECT sessions.archived, session_control_states.active_run_id,
      EXISTS (SELECT 1 FROM pinned_sessions WHERE pinned_sessions.session_id = sessions.id)
        AS pinned,
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
        AS pending_worker_update_count,
      -- A Worker still working, or one with an open result whose Run, Follow-up or wake is still
      -- to come, reports to this Session later.
      (SELECT COUNT(*) FROM delegation_contracts AS delegations
        WHERE delegations.parent_session_id = sessions.id
          AND (
            delegations.state IN (${'working'}, ${'waiting'}, ${'revision_requested'})
            OR (
              delegations.state NOT IN (${'accepted'}, ${'cancelled'})
              AND (
                EXISTS (SELECT 1 FROM session_control_states AS worker
                  WHERE worker.session_id = delegations.child_session_id
                    AND worker.active_run_id IS NOT NULL)
                OR EXISTS (SELECT 1 FROM session_follow_ups AS worker_follow_ups
                  WHERE worker_follow_ups.session_id = delegations.child_session_id)
                -- Its own Worker reported, so a wake Run of it is about to start.
                OR EXISTS (SELECT 1 FROM session_orchestration_updates AS worker_updates
                  WHERE worker_updates.parent_session_id = delegations.child_session_id
                    AND worker_updates.status = ${'pending'})
              )
            )
          ))
        AS working_delegation_count
    FROM sessions
    LEFT JOIN session_control_states ON session_control_states.session_id = sessions.id
    WHERE sessions.id = ${input.sessionId}
    LIMIT 1
  `.pipe(
    Effect.flatMap((rows) =>
      Effect.try(() => {
        const row = rows[0]
        if (!row) return null
        return {
          archived: row.archived === 1,
          pinned: row.pinned === 1,
          activeRunId: row.active_run_id,
          queuedFollowUpCount: row.queued_follow_up_count,
          runStatus: decodeRunStatus(row.run_status),
          laterRunCount: row.later_run_count,
          pendingWorkerUpdateCount: row.pending_worker_update_count,
          workingDelegationCount: row.working_delegation_count,
        }
      }),
    ),
    Effect.mapError(
      (cause) => new SessionControlRepositoryError({ operation: 'read-self-archive-state', cause }),
    ),
  )
}
