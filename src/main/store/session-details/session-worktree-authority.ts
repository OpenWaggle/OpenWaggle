import * as SqlClient from '@effect/sql/SqlClient'
import type { SessionId } from '@shared/types/brand'
import type { SessionEnvironmentMode } from '@shared/types/git'
import * as Effect from 'effect/Effect'
import {
  assertSessionAuthoritySnapshotForWorkspace,
  decodeSessionAuthoritySnapshot,
  encodeSessionAuthoritySnapshot,
  provisionalSessionAuthoritySnapshot,
  retargetSessionAuthoritySnapshot,
} from '../../session-host/session-authority-snapshot'
import { runStoreEffect } from '../store-runtime'

interface WorkspaceAuthorityRow {
  readonly session_id: string
  readonly project_path: string
  readonly workspace_id: string
  readonly working_path: string
  readonly lifecycle_state: string
  readonly authority_scope_snapshot_json: string | null
  readonly authority_origin_caller_id: string | null
}

function loadWorkspaceAuthority(sql: SqlClient.SqlClient, id: SessionId) {
  return sql<WorkspaceAuthorityRow>`
    SELECT sessions.id AS session_id, workspace_resources.project_path,
      workspace_resources.id AS workspace_id, workspace_resources.working_path,
      workspace_resources.lifecycle_state,
      session_execution_profiles.authority_scope_snapshot_json,
      session_execution_profiles.authority_origin_caller_id
    FROM sessions
    JOIN session_workspace_bindings ON session_workspace_bindings.session_id = sessions.id
    JOIN workspace_resources ON workspace_resources.id = session_workspace_bindings.workspace_id
    LEFT JOIN session_execution_profiles ON session_execution_profiles.session_id = sessions.id
    WHERE sessions.id = ${id}
    LIMIT 1
  `
}

export async function validateSessionWorktreeBirthAuthority(input: {
  readonly sessionId: SessionId
  readonly workspaceId: string
  readonly projectPath: string
  readonly plannedWorkingPath: string
}) {
  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const row = (yield* loadWorkspaceAuthority(sql, input.sessionId))[0]
      if (
        !row ||
        row.workspace_id !== input.workspaceId ||
        row.project_path !== input.projectPath ||
        (row.working_path !== input.plannedWorkingPath &&
          !row.working_path.startsWith('pending://')) ||
        (row.lifecycle_state !== 'pending' && row.lifecycle_state !== 'ready')
      ) {
        return yield* Effect.fail(new Error('Session Workspace changed before worktree birth.'))
      }
      const workspaceState: 'pending' | 'ready' = row.lifecycle_state
      const snapshot = decodeSessionAuthoritySnapshot(row.authority_scope_snapshot_json)
      if (!snapshot) return
      if (snapshot.projectPath !== row.project_path) {
        return yield* Effect.fail(new Error('Session project differs from its authority snapshot.'))
      }
      const candidate =
        workspaceState === 'pending'
          ? provisionalSessionAuthoritySnapshot(
              snapshot,
              input.plannedWorkingPath,
              row.authority_origin_caller_id ?? 'local-user',
            )
          : snapshot
      if (workspaceState === 'ready' && snapshot.workingPath !== row.working_path) {
        return yield* Effect.fail(
          new Error('Session worktree differs from its authority snapshot.'),
        )
      }
      yield* Effect.tryPromise({
        try: () => assertSessionAuthoritySnapshotForWorkspace(candidate, workspaceState),
        catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
      })
    }),
  )
}

export async function setSessionWorktree(
  id: SessionId,
  environmentMode: SessionEnvironmentMode,
  worktreePath: string | null,
  worktreeBranch?: string,
): Promise<void> {
  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const now = Date.now()
      yield* sql.withTransaction(
        Effect.gen(function* () {
          const source = (yield* loadWorkspaceAuthority(sql, id))[0]
          if (!source) {
            yield* sql`
              UPDATE sessions
              SET environment_mode = ${environmentMode}, worktree_path = ${worktreePath},
                  updated_at = ${now}
              WHERE id = ${id}
            `
            return
          }
          const peers = yield* sql<WorkspaceAuthorityRow>`
            SELECT sessions.id AS session_id, workspace_resources.project_path,
              workspace_resources.id AS workspace_id, workspace_resources.working_path,
              workspace_resources.lifecycle_state,
              session_execution_profiles.authority_scope_snapshot_json,
              session_execution_profiles.authority_origin_caller_id
            FROM session_workspace_bindings AS source_binding
            JOIN session_workspace_bindings AS peer_binding
              ON peer_binding.workspace_id = source_binding.workspace_id
            JOIN sessions ON sessions.id = peer_binding.session_id
            JOIN workspace_resources ON workspace_resources.id = peer_binding.workspace_id
            LEFT JOIN session_execution_profiles
              ON session_execution_profiles.session_id = sessions.id
            WHERE source_binding.session_id = ${id}
          `
          const refreshed: Array<{ readonly sessionId: string; readonly snapshot: string }> = []
          if (environmentMode === 'worktree' && worktreePath) {
            for (const peer of peers) {
              const snapshot = decodeSessionAuthoritySnapshot(peer.authority_scope_snapshot_json)
              if (!snapshot) continue
              if (snapshot.projectPath !== peer.project_path) {
                return yield* Effect.fail(
                  new Error('Session project differs from its authority snapshot.'),
                )
              }
              const next = retargetSessionAuthoritySnapshot(
                snapshot,
                worktreePath,
                peer.authority_origin_caller_id ?? 'local-user',
              )
              yield* Effect.tryPromise({
                try: () => assertSessionAuthoritySnapshotForWorkspace(next, 'ready'),
                catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
              })
              refreshed.push({
                sessionId: peer.session_id,
                snapshot: encodeSessionAuthoritySnapshot(next),
              })
            }
          }
          yield* sql`
            UPDATE sessions
            SET environment_mode = ${environmentMode}, worktree_path = ${worktreePath},
                updated_at = ${now}
            WHERE id = ${id} OR id IN (
              SELECT peer.session_id
              FROM session_workspace_bindings AS source_binding
              JOIN session_workspace_bindings AS peer
                ON peer.workspace_id = source_binding.workspace_id
              WHERE source_binding.session_id = ${id}
            )
          `
          if (environmentMode === 'worktree' && worktreePath) {
            yield* sql`
              UPDATE workspace_resources
              SET working_path = ${worktreePath}, lifecycle_state = ${'ready'},
                  worktree_branch = COALESCE(${worktreeBranch ?? null}, worktree_branch),
                  handoff_seed_state = CASE
                    WHEN handoff_seed_state = 'pending' THEN 'applied'
                    ELSE handoff_seed_state
                  END,
                  updated_at = ${now}
              WHERE id = ${source.workspace_id}
            `
            for (const item of refreshed) {
              yield* sql`
                UPDATE session_execution_profiles
                SET authority_scope_snapshot_json = ${item.snapshot}, updated_at = ${now}
                WHERE session_id = ${item.sessionId}
              `
            }
          }
        }),
      )
    }),
  )
}
