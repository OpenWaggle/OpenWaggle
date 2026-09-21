import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import type { SessionControlRunExecutionInput } from '../ports/session-control-run-executor'
import {
  resolveSessionRunExecution,
  type SessionRunExecutionProfileRow,
} from './session-run-execution-profile'

export function loadRunExecutionProfile(
  sql: SqlClient.SqlClient,
  input: Pick<SessionControlRunExecutionInput, 'sessionId' | 'runId'>,
) {
  return Effect.gen(function* () {
    const rows = yield* sql<SessionRunExecutionProfileRow>`
      SELECT
        sessions.id AS session_id,
        sessions.title,
        sessions.project_path,
        session_execution_profiles.profile_json,
        session_execution_profiles.resolved_agent_snapshot_json,
        session_execution_profiles.authorization_ceiling,
        session_spawn_lineage.parent_session_id,
        parent_sessions.title AS parent_title,
        session_spawn_lineage.hive_root_session_id,
        session_spawn_lineage.depth,
        (SELECT COUNT(*) FROM session_spawn_lineage AS child_lineage
          WHERE child_lineage.parent_session_id = sessions.id) AS direct_worker_count,
        workspace_resources.id AS workspace_id,
        workspace_resources.kind AS workspace_kind,
        workspace_resources.working_path,
        derived_child_management_grants.capabilities_json,
        delegation_contracts.id AS delegation_id,
        delegation_contracts.state AS delegation_state
      FROM sessions
      JOIN session_execution_profiles ON session_execution_profiles.session_id = sessions.id
      JOIN session_workspace_bindings ON session_workspace_bindings.session_id = sessions.id
      JOIN workspace_resources ON workspace_resources.id = session_workspace_bindings.workspace_id
      LEFT JOIN session_spawn_lineage ON session_spawn_lineage.child_session_id = sessions.id
      LEFT JOIN sessions AS parent_sessions ON parent_sessions.id = session_spawn_lineage.parent_session_id
      LEFT JOIN derived_child_management_grants
        ON derived_child_management_grants.child_session_id = sessions.id
        AND derived_child_management_grants.revoked_at IS NULL
      LEFT JOIN delegation_contracts ON delegation_contracts.child_session_id = sessions.id
      WHERE sessions.id = ${input.sessionId}
      LIMIT 1
    `
    const row = rows[0]
    if (!row) {
      return yield* Effect.fail(
        new Error(`Session ${input.sessionId} has no durable execution profile or Workspace.`),
      )
    }
    return yield* Effect.try({
      try: () => resolveSessionRunExecution(row, input.runId),
      catch: (cause) =>
        new Error(`Session ${input.sessionId} has an invalid durable execution profile.`, {
          cause,
        }),
    })
  })
}
