import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import {
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

export const SqliteSessionWorkspaceResourceRepositoryLive = Layer.effect(
  SessionWorkspaceResourceRepository,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return SessionWorkspaceResourceRepository.of({
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
