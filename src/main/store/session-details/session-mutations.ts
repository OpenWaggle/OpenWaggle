import * as SqlClient from '@effect/sql/SqlClient'
import type { AgentAuthorizationMode } from '@shared/types/agent-authorization'
import type { SessionId } from '@shared/types/brand'
import type { SessionEnvironmentMode } from '@shared/types/git'
import * as Effect from 'effect/Effect'
import { runStoreEffect } from '../store-runtime'
import { EMPTY_INDEX } from './constants'
import type { UpdateSessionRuntimeInput } from './types'

export interface SessionWorktreeRefRow {
  readonly sessionId: string
  readonly worktreePath: string | null
}

export interface BoundWorkspaceResource {
  readonly id: string
  readonly projectPath: string
  readonly kind: 'local' | 'managed-worktree'
  readonly workingPath: string
  readonly lifecycleState:
    | 'pending'
    | 'materializing'
    | 'ready'
    | 'missing'
    | 'releasing'
    | 'failed'
  readonly worktreeBranch: string | null
  readonly worktreeBaseRef: string | null
  readonly worktreeStartFromOrigin: boolean
  readonly handoffSeedRef: string | null
  readonly handoffSeedBaseRef: string | null
  readonly handoffSeedState: 'none' | 'pending' | 'applied' | 'failed'
}

export async function getBoundWorkspaceResource(
  id: SessionId,
): Promise<BoundWorkspaceResource | null> {
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const rows = yield* sql<{
        readonly id: string
        readonly project_path: string
        readonly kind: 'local' | 'managed-worktree'
        readonly working_path: string
        readonly lifecycle_state: BoundWorkspaceResource['lifecycleState']
        readonly worktree_branch: string | null
        readonly worktree_base_ref: string | null
        readonly worktree_start_from_origin: number
        readonly handoff_seed_ref: string | null
        readonly handoff_seed_base_ref: string | null
        readonly handoff_seed_state: BoundWorkspaceResource['handoffSeedState']
      }>`
        SELECT
          workspace_resources.id,
          workspace_resources.project_path,
          workspace_resources.kind,
          workspace_resources.working_path,
          workspace_resources.lifecycle_state,
          workspace_resources.worktree_branch,
          workspace_resources.worktree_base_ref,
          workspace_resources.worktree_start_from_origin,
          workspace_resources.handoff_seed_ref,
          workspace_resources.handoff_seed_base_ref,
          workspace_resources.handoff_seed_state
        FROM session_workspace_bindings
        JOIN workspace_resources
          ON workspace_resources.id = session_workspace_bindings.workspace_id
        WHERE session_workspace_bindings.session_id = ${id}
        LIMIT 1
      `
      const row = rows[0]
      return row
        ? {
            id: row.id,
            projectPath: row.project_path,
            kind: row.kind,
            workingPath: row.working_path,
            lifecycleState: row.lifecycle_state,
            worktreeBranch: row.worktree_branch,
            worktreeBaseRef: row.worktree_base_ref,
            worktreeStartFromOrigin: row.worktree_start_from_origin === 1,
            handoffSeedRef: row.handoff_seed_ref,
            handoffSeedBaseRef: row.handoff_seed_base_ref,
            handoffSeedState: row.handoff_seed_state,
          }
        : null
    }),
  )
}

/** Persist a session's environment mode and Session worktree path (birth). */
export async function setSessionWorktree(
  id: SessionId,
  environmentMode: SessionEnvironmentMode,
  worktreePath: string | null,
  worktreeBranch?: string,
): Promise<void> {
  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`
        UPDATE sessions
        SET environment_mode = ${environmentMode},
            worktree_path = ${worktreePath},
            updated_at = ${Date.now()}
        WHERE id = ${id}
          OR id IN (
            SELECT peer.session_id
            FROM session_workspace_bindings AS source
            JOIN session_workspace_bindings AS peer ON peer.workspace_id = source.workspace_id
            WHERE source.session_id = ${id}
          )
      `
      if (environmentMode === 'worktree' && worktreePath) {
        yield* sql`
          UPDATE workspace_resources
          SET working_path = ${worktreePath},
              lifecycle_state = ${'ready'},
              worktree_branch = COALESCE(${worktreeBranch ?? null}, worktree_branch),
              handoff_seed_state = CASE
                WHEN handoff_seed_state = 'pending' THEN 'applied'
                ELSE handoff_seed_state
              END,
              updated_at = ${Date.now()}
          WHERE id = (
            SELECT workspace_id
            FROM session_workspace_bindings
            WHERE session_id = ${id}
          )
        `
      }
    }),
  )
}

/** Persist the per-session env mode + Worktree base ref plan (before birth). */
export async function setSessionWorktreePlan(
  id: SessionId,
  environmentMode: SessionEnvironmentMode,
  baseRef: string | null,
  startFromOrigin: boolean,
): Promise<void> {
  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`
        UPDATE sessions
        SET environment_mode = ${environmentMode},
            worktree_base_ref = ${baseRef},
            worktree_start_from_origin = ${startFromOrigin ? 1 : 0},
            updated_at = ${Date.now()}
        WHERE id = ${id}
      `
    }),
  )
}

/** Stores a session override, or clears it with `null` so the session inherits again. */
export async function setSessionAuthorizationMode(
  id: SessionId,
  authorizationMode: AgentAuthorizationMode | null,
): Promise<void> {
  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`
        UPDATE sessions
        SET authorization_mode_override = ${authorizationMode},
            updated_at = ${Date.now()}
        WHERE id = ${id}
      `
    }),
  )
}

/** Clear a session's Session worktree binding (death). */
export async function clearSessionWorktree(id: SessionId): Promise<void> {
  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`UPDATE sessions SET worktree_path = NULL, updated_at = ${Date.now()} WHERE id = ${id}`
    }),
  )
}

/** All sessions' worktree paths, for orphan detection before removal. */
export async function listSessionWorktreeRefs(): Promise<SessionWorktreeRefRow[]> {
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const rows = yield* sql<{
        readonly session_id: string
        readonly working_path: string
      }>`
        SELECT bindings.session_id, resources.working_path
        FROM session_workspace_bindings AS bindings
        JOIN workspace_resources AS resources ON resources.id = bindings.workspace_id
        WHERE resources.kind = ${'managed-worktree'}
        ORDER BY bindings.session_id
      `
      return rows.map((row) => ({ sessionId: row.session_id, worktreePath: row.working_path }))
    }),
  )
}

export async function updateSessionRuntime(input: UpdateSessionRuntimeInput): Promise<void> {
  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`
        UPDATE sessions
        SET pi_session_id = COALESCE(${input.piSessionId ?? null}, pi_session_id),
            pi_session_file = COALESCE(${input.piSessionFile ?? null}, pi_session_file),
            updated_at = ${Date.now()}
        WHERE id = ${input.sessionId}
      `
    }),
  )
}

export async function deleteSession(id: SessionId): Promise<void> {
  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql.withTransaction(
        Effect.gen(function* () {
          const bindings = yield* sql<{ readonly workspace_id: string }>`
            SELECT workspace_id
            FROM session_workspace_bindings
            WHERE session_id = ${id}
            LIMIT 1
          `
          yield* sql`DELETE FROM sessions WHERE id = ${id}`
          const workspaceId = bindings[EMPTY_INDEX]?.workspace_id
          if (workspaceId) {
            yield* sql`
              DELETE FROM workspace_resources
              WHERE id = ${workspaceId}
                AND NOT EXISTS (
                  SELECT 1 FROM session_workspace_bindings
                  WHERE workspace_id = ${workspaceId}
                )
            `
          }
        }),
      )
    }),
  )
}

async function updateArchivedState(id: SessionId, archived: boolean) {
  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`
        UPDATE sessions
        SET archived = ${archived ? 1 : 0}, updated_at = ${Date.now()}
        WHERE id = ${id}
      `
    }),
  )
}

export async function archiveSession(id: SessionId): Promise<void> {
  await updateArchivedState(id, true)
}

export async function unarchiveSession(id: SessionId): Promise<void> {
  await updateArchivedState(id, false)
}

export async function updateSessionTitle(id: SessionId, title: string): Promise<void> {
  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`
        UPDATE sessions
        SET title = ${title}, updated_at = ${Date.now()}
        WHERE id = ${id}
      `
    }),
  )
}
