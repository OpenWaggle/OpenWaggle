import type * as SqlClient from '@effect/sql/SqlClient'
import { parseJsonUnknown } from '@shared/schema'
import { decodeLocalSessionProfileScope } from '@shared/schemas/local-session-profile'
import type { AgentAuthorizationMode } from '@shared/types/agent-authorization'
import * as Effect from 'effect/Effect'
import {
  isLocalUserCallerId,
  isProfileCallerId,
} from '../domain/session-control/root-session-project-reach'
import type {
  ScheduledTaskAuthorityBoundary,
  ScheduledTaskRepositoryShape,
} from '../ports/scheduled-task-repository'
import { sessionAgentAuthorizationBoundary } from '../session-host/session-agent-run-ceiling'
import { sessionReachesEveryProject } from './session-agent-run-project-reach'
import { repositoryError } from './sqlite-scheduled-task-rows'

type SessionMethods = Pick<
  ScheduledTaskRepositoryShape,
  | 'sessionAuthorityOrigin'
  | 'sessionActivity'
  | 'sessionAuthorityBoundary'
  | 'callerAuthorityBoundary'
  | 'projectKnown'
>

const NO_REACH: ScheduledTaskAuthorityBoundary = {
  reachesEveryProject: false,
  authorizationCeiling: 'ask-for-approval',
}

function sessionAuthorityBoundary(sql: SqlClient.SqlClient, sessionId: string) {
  return Effect.gen(function* () {
    const exists = yield* sql<{ readonly id: string }>`
      SELECT session_id AS id FROM session_execution_profiles WHERE session_id = ${sessionId} LIMIT 1
    `
    if (exists.length === 0) return null
    const reachesEveryProject = yield* sessionReachesEveryProject(sql, sessionId)
    const boundary = yield* sessionAgentAuthorizationBoundary(sql, sessionId)
    return {
      reachesEveryProject,
      authorizationCeiling: boundary.authorizationCeiling,
    } satisfies ScheduledTaskAuthorityBoundary
  }).pipe(Effect.mapError(repositoryError('session-authority-boundary')))
}

/** An unreadable scope counts as every project, since callers refuse on that reach. */
function profileReachesEveryProject(scopeJson: string) {
  try {
    return decodeLocalSessionProfileScope(parseJsonUnknown(scopeJson)).all === true
  } catch {
    return true
  }
}

function callerAuthorityBoundary(sql: SqlClient.SqlClient, callerId: string) {
  if (isLocalUserCallerId(callerId)) {
    return Effect.succeed<ScheduledTaskAuthorityBoundary>({
      reachesEveryProject: true,
      authorizationCeiling: 'yolo',
    })
  }
  if (!isProfileCallerId(callerId)) return Effect.succeed(NO_REACH)
  return sql<{
    readonly scope_json: string
    readonly authorization_ceiling: AgentAuthorizationMode
    readonly revoked_at: number | null
  }>`
    SELECT scope_json, authorization_ceiling, revoked_at FROM session_client_profiles
    WHERE id = ${callerId.slice('profile:'.length)} LIMIT 1
  `.pipe(
    Effect.map((rows) => {
      const profile = rows[0]
      if (profile?.revoked_at !== null) return NO_REACH
      return {
        reachesEveryProject: profileReachesEveryProject(profile.scope_json),
        authorizationCeiling: profile.authorization_ceiling,
      }
    }),
    Effect.mapError(repositoryError('caller-authority-boundary')),
  )
}

export function scheduledTaskSessionMethods(sql: SqlClient.SqlClient) {
  return {
    sessionAuthorityBoundary: (sessionId) => sessionAuthorityBoundary(sql, sessionId),
    callerAuthorityBoundary: (callerId) => callerAuthorityBoundary(sql, callerId),
    projectKnown: (projectPath) =>
      sql<{ readonly known: number }>`
        SELECT EXISTS (SELECT 1 FROM sessions WHERE project_path = ${projectPath})
          OR EXISTS (SELECT 1 FROM workspace_resources WHERE project_path = ${projectPath})
          AS known
      `.pipe(
        Effect.map((rows) => rows[0]?.known === 1),
        Effect.mapError(repositoryError('project-known')),
      ),
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
  } satisfies SessionMethods
}
