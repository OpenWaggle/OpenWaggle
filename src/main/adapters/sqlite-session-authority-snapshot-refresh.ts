import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import {
  assertSessionAuthoritySnapshotForWorkspace,
  decodeSessionAuthoritySnapshot,
  encodeSessionAuthoritySnapshot,
  provisionalSessionAuthoritySnapshot,
  retargetSessionAuthoritySnapshot,
} from '../session-host/session-authority-snapshot'

export function refreshSessionAuthoritySnapshotWorkingPath(
  sql: SqlClient.SqlClient,
  input: {
    readonly sessionId: string
    readonly projectPath: string
    readonly workingPath: string
    readonly workspaceState: 'pending' | 'ready'
    readonly now: number
  },
) {
  return Effect.gen(function* () {
    const rows = yield* sql<{
      readonly authority_origin_caller_id: string
      readonly authority_scope_snapshot_json: string | null
    }>`
      SELECT authority_origin_caller_id, authority_scope_snapshot_json
      FROM session_execution_profiles
      WHERE session_id = ${input.sessionId}
      LIMIT 1
    `
    const snapshot = decodeSessionAuthoritySnapshot(rows[0]?.authority_scope_snapshot_json)
    if (!snapshot) return
    if (snapshot.projectPath !== input.projectPath) {
      return yield* Effect.fail(new Error('Handoff project differs from the authority snapshot.'))
    }
    const refreshed = retargetSessionAuthoritySnapshot(
      snapshot,
      input.workingPath,
      rows[0]?.authority_origin_caller_id ?? 'local-user',
    )
    yield* Effect.tryPromise({
      try: () => assertSessionAuthoritySnapshotForWorkspace(refreshed, input.workspaceState),
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    })
    yield* sql`
      UPDATE session_execution_profiles
      SET authority_scope_snapshot_json = ${encodeSessionAuthoritySnapshot(refreshed)},
          updated_at = ${input.now}
      WHERE session_id = ${input.sessionId}
    `
  })
}

export function refreshHandoffAuthority(
  sql: SqlClient.SqlClient,
  sessionId: string,
  workspace: {
    readonly project_path: string
    readonly working_path: string
    readonly lifecycle_state: string
  },
  now: number,
) {
  if (workspace.lifecycle_state !== 'ready') return Effect.void
  return refreshSessionAuthoritySnapshotWorkingPath(sql, {
    sessionId,
    projectPath: workspace.project_path,
    workingPath: workspace.working_path,
    workspaceState: 'ready',
    now,
  })
}

export function assertBoundSessionAuthoritySnapshot(sql: SqlClient.SqlClient, sessionId: string) {
  return Effect.gen(function* () {
    const rows = yield* sql<{
      readonly authority_scope_snapshot_json: string | null
      readonly authority_origin_caller_id: string
      readonly project_path: string
      readonly working_path: string
      readonly lifecycle_state: string
    }>`
      SELECT session_execution_profiles.authority_scope_snapshot_json,
        session_execution_profiles.authority_origin_caller_id,
        workspace_resources.project_path, workspace_resources.working_path,
        workspace_resources.lifecycle_state
      FROM session_execution_profiles
      JOIN session_workspace_bindings
        ON session_workspace_bindings.session_id = session_execution_profiles.session_id
      JOIN workspace_resources
        ON workspace_resources.id = session_workspace_bindings.workspace_id
      WHERE session_execution_profiles.session_id = ${sessionId}
      LIMIT 1
    `
    const row = rows[0]
    const snapshot = decodeSessionAuthoritySnapshot(row?.authority_scope_snapshot_json)
    if (!snapshot) return
    if (
      !row ||
      snapshot.projectPath !== row.project_path ||
      (row.lifecycle_state !== 'pending' && row.lifecycle_state !== 'ready') ||
      (row.lifecycle_state === 'ready' && snapshot.workingPath !== row.working_path)
    ) {
      return yield* Effect.fail(new Error('Bound Workspace differs from the authority snapshot.'))
    }
    const workspaceState: 'pending' | 'ready' = row.lifecycle_state
    const candidate =
      workspaceState === 'pending'
        ? provisionalSessionAuthoritySnapshot(
            snapshot,
            row.working_path,
            row.authority_origin_caller_id,
          )
        : snapshot
    yield* Effect.tryPromise({
      try: () => assertSessionAuthoritySnapshotForWorkspace(candidate, workspaceState),
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    })
  })
}
