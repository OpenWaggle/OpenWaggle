import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import {
  type ManagedWorktreeRemovalAdmission,
  type SessionWorkspaceResource,
  SessionWorkspaceResourceRepository,
} from '../ports/session-workspace-resource-repository'

interface WorkspaceRow {
  readonly id: string
  readonly project_path: string
  readonly kind: SessionWorkspaceResource['kind']
  readonly working_path: string
  readonly worktree_branch: string | null
}

interface BindingCountRow {
  readonly binding_count: number
}

interface RemovalCandidateRow {
  readonly id: string
  readonly project_path: string
  readonly working_path: string
}

interface RemovalWorkspaceRow extends RemovalCandidateRow {
  readonly lifecycle_state: string
  readonly binding_count: number
}

interface ChangesRow {
  readonly changes: number
}

function repositoryError(message: string, cause: unknown) {
  return new Error(message, { cause })
}

function loadRemovalWorkspace(sql: SqlClient.SqlClient, resourceId: string) {
  return sql<RemovalWorkspaceRow>`
    SELECT resources.id, resources.project_path, resources.working_path,
      resources.lifecycle_state, COUNT(bindings.session_id) AS binding_count
    FROM workspace_resources AS resources
    LEFT JOIN session_workspace_bindings AS bindings ON bindings.workspace_id = resources.id
    WHERE resources.id = ${resourceId} AND resources.kind = ${'managed-worktree'}
    GROUP BY resources.id
    LIMIT 1
  `
}

function admitManagedWorktreeRemoval(
  sql: SqlClient.SqlClient,
  input: {
    readonly resourceId?: string
    readonly reservationId: string
    readonly projectPath: string
    readonly workingPath: string
  },
) {
  return sql.withTransaction(
    Effect.gen(function* () {
      const existing = input.resourceId
        ? (yield* loadRemovalWorkspace(sql, input.resourceId))[0]
        : undefined
      if (existing) {
        if (existing.binding_count > 0 || existing.lifecycle_state !== 'ready') {
          return { status: 'unavailable' } as const
        }
        yield* sql`
          UPDATE workspace_resources SET lifecycle_state = ${'releasing'}, updated_at = ${Date.now()}
          WHERE id = ${existing.id} AND lifecycle_state = ${'ready'}
            AND NOT EXISTS (
              SELECT 1 FROM session_workspace_bindings WHERE workspace_id = ${existing.id}
            )
        `
        const changed = (yield* sql<ChangesRow>`SELECT changes() AS changes`)[0]?.changes ?? 0
        return changed === 1
          ? ({
              status: 'reserved',
              resourceId: existing.id,
              createdReservation: false,
            } satisfies ManagedWorktreeRemovalAdmission)
          : ({ status: 'unavailable' } satisfies ManagedWorktreeRemovalAdmission)
      }
      const now = Date.now()
      yield* sql`
        INSERT OR IGNORE INTO workspace_resources (
          id, project_path, kind, working_path, lifecycle_state, worktree_branch,
          worktree_base_ref, created_at, updated_at
        ) VALUES (
          ${input.reservationId}, ${input.projectPath}, ${'managed-worktree'},
          ${input.workingPath}, ${'releasing'}, ${null}, ${null}, ${now}, ${now}
        )
      `
      const changed = (yield* sql<ChangesRow>`SELECT changes() AS changes`)[0]?.changes ?? 0
      return changed === 1
        ? ({
            status: 'reserved',
            resourceId: input.reservationId,
            createdReservation: true,
          } satisfies ManagedWorktreeRemovalAdmission)
        : ({ status: 'unavailable' } satisfies ManagedWorktreeRemovalAdmission)
    }),
  )
}

function finalizeManagedWorktreeRemoval(
  sql: SqlClient.SqlClient,
  input: {
    readonly resourceId: string
    readonly createdReservation: boolean
    readonly removed: boolean
  },
) {
  return sql.withTransaction(
    Effect.gen(function* () {
      if (input.removed || input.createdReservation) {
        yield* sql`
          DELETE FROM workspace_resources
          WHERE id = ${input.resourceId} AND lifecycle_state = ${'releasing'}
            AND NOT EXISTS (
              SELECT 1 FROM session_workspace_bindings WHERE workspace_id = ${input.resourceId}
            )
        `
        return
      }
      yield* sql`
        UPDATE workspace_resources SET lifecycle_state = ${'ready'}, updated_at = ${Date.now()}
        WHERE id = ${input.resourceId} AND lifecycle_state = ${'releasing'}
          AND NOT EXISTS (
            SELECT 1 FROM session_workspace_bindings WHERE workspace_id = ${input.resourceId}
          )
      `
    }),
  )
}

export const SqliteSessionWorkspaceResourceRepositoryLive = Layer.effect(
  SessionWorkspaceResourceRepository,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return SessionWorkspaceResourceRepository.of({
      listManagedWorktreeRemovalCandidates: () =>
        sql<RemovalCandidateRow>`
          SELECT id, project_path, working_path
          FROM workspace_resources
          WHERE kind = ${'managed-worktree'}
        `.pipe(
          Effect.map((rows) =>
            rows.map((row) => ({
              id: row.id,
              projectPath: row.project_path,
              workingPath: row.working_path,
            })),
          ),
          Effect.mapError((cause) =>
            repositoryError('Failed to list managed worktree resources.', cause),
          ),
        ),
      admitManagedWorktreeRemoval: (input) =>
        admitManagedWorktreeRemoval(sql, input).pipe(
          Effect.mapError((cause) =>
            repositoryError('Failed to reserve managed worktree removal.', cause),
          ),
        ),
      finalizeManagedWorktreeRemoval: (input) =>
        finalizeManagedWorktreeRemoval(sql, input).pipe(
          Effect.mapError((cause) =>
            repositoryError('Failed to finalize managed worktree removal.', cause),
          ),
        ),
      countManagedWorktreeBindings: (input) =>
        Effect.gen(function* () {
          const rows = yield* sql<BindingCountRow>`
            SELECT COUNT(bindings.session_id) AS binding_count
            FROM workspace_resources AS resources
            LEFT JOIN session_workspace_bindings AS bindings
              ON bindings.workspace_id = resources.id
            WHERE resources.project_path = ${input.projectPath}
              AND resources.working_path = ${input.workingPath}
              AND resources.kind = ${'managed-worktree'}
          `
          return rows[0]?.binding_count ?? 0
        }).pipe(
          Effect.mapError(
            (cause) => new Error('Failed to inspect managed worktree bindings.', { cause }),
          ),
        ),
      getBound: (sessionId) =>
        Effect.gen(function* () {
          const rows = yield* sql<WorkspaceRow>`
            SELECT resources.id, resources.project_path, resources.kind,
              resources.working_path, resources.worktree_branch
            FROM session_workspace_bindings AS bindings
            JOIN workspace_resources AS resources ON resources.id = bindings.workspace_id
            WHERE bindings.session_id = ${sessionId}
            LIMIT 1
          `
          const row = rows[0]
          return row
            ? {
                id: row.id,
                projectPath: row.project_path,
                kind: row.kind,
                workingPath: row.working_path,
                worktreeBranch: row.worktree_branch,
              }
            : null
        }).pipe(
          Effect.mapError((cause) => new Error('Failed to read Session Workspace.', { cause })),
        ),
    })
  }),
)
