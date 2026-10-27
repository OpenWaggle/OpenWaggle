import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import type { ScheduledTaskRepositoryShape } from '../ports/scheduled-task-repository'
import { repositoryError } from './sqlite-scheduled-task-rows'

type SessionMethods = Pick<
  ScheduledTaskRepositoryShape,
  'sessionAuthorityOrigin' | 'sessionActivity'
>

export function scheduledTaskSessionMethods(sql: SqlClient.SqlClient): SessionMethods {
  return {
    sessionAuthorityOrigin: (sessionId) =>
      sql<{
        readonly authority_origin_caller_id: string
        readonly title: string
        readonly archived: number
      }>`
        SELECT session_execution_profiles.authority_origin_caller_id, sessions.title,
          sessions.archived
        FROM sessions
        JOIN session_execution_profiles ON session_execution_profiles.session_id = sessions.id
        WHERE sessions.id = ${sessionId} LIMIT 1
      `.pipe(
        Effect.map((rows) => {
          const row = rows[0]
          return row
            ? {
                originCallerId: row.authority_origin_caller_id,
                title: row.title,
                archived: row.archived === 1,
              }
            : null
        }),
        Effect.mapError(repositoryError('session-authority-origin')),
      ),
    sessionActivity: (sessionId) =>
      sql<{
        readonly archived: number
        readonly active_run_id: string | null
        readonly follow_up_count: number
        readonly pinned: number
        readonly run_count: number
        readonly latest_run_status: string | null
        readonly pi_session_file: string | null
        readonly project_path: string | null
        readonly working_path: string | null
      }>`
        SELECT sessions.archived, session_control_states.active_run_id,
          (SELECT COUNT(*) FROM session_follow_ups
            WHERE session_follow_ups.session_id = sessions.id) AS follow_up_count,
          EXISTS (SELECT 1 FROM pinned_sessions
            WHERE pinned_sessions.session_id = sessions.id) AS pinned,
          (SELECT COUNT(*) FROM session_runs WHERE session_runs.session_id = sessions.id) AS run_count,
          (SELECT status FROM session_runs WHERE session_runs.session_id = sessions.id
            ORDER BY created_at DESC, id DESC LIMIT 1) AS latest_run_status,
          sessions.pi_session_file, sessions.project_path,
          (SELECT workspace_resources.working_path FROM session_workspace_bindings
            JOIN workspace_resources
              ON workspace_resources.id = session_workspace_bindings.workspace_id
            WHERE session_workspace_bindings.session_id = sessions.id LIMIT 1) AS working_path
        FROM sessions
        LEFT JOIN session_control_states ON session_control_states.session_id = sessions.id
        WHERE sessions.id = ${sessionId} LIMIT 1
      `.pipe(
        Effect.map((rows) => {
          const row = rows[0]
          return row
            ? {
                archived: row.archived === 1,
                activeRunId: row.active_run_id,
                followUpCount: row.follow_up_count,
                pinned: row.pinned === 1,
                runCount: row.run_count,
                latestRunStatus: row.latest_run_status,
                piSessionFile: row.pi_session_file,
                workingPath: row.working_path,
                projectPath: row.project_path,
              }
            : null
        }),
        Effect.mapError(repositoryError('session-activity')),
      ),
  }
}
