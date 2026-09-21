import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import type { ActionRunWorkspace } from '../../ports/action-run-service'
import { WorkspaceExecutionAdmission } from '../../ports/workspace-execution-admission'

export function createActionWorkspaceAdmission(sql: SqlClient.SqlClient) {
  const locks = new Map<string, Effect.Semaphore>()
  const withWorkspaceMutation = <A, E, R>(id: string, operation: Effect.Effect<A, E, R>) =>
    Effect.suspend(() => {
      let lock = locks.get(id)
      if (!lock) {
        lock = Effect.unsafeMakeSemaphore(1)
        locks.set(id, lock)
      }
      return lock.withPermits(1)(operation)
    })
  const requireActive = (workspace: ActionRunWorkspace) =>
    Effect.gen(function* () {
      const rows = yield* sql<{
        readonly id: string
      }>`SELECT resources.id FROM workspace_resources resources
      JOIN session_workspace_bindings bindings ON bindings.workspace_id = resources.id
      JOIN sessions ON sessions.id = bindings.session_id
      WHERE resources.id = ${workspace.workspaceId} AND resources.lifecycle_state = 'ready'
        AND sessions.archived = 0
        AND (${workspace.sessionId ?? null} IS NULL OR sessions.id = ${workspace.sessionId ?? null})
        AND resources.project_path = ${workspace.projectPath} AND resources.working_path = ${workspace.workspacePath}
      LIMIT 1`
      if (!rows[0])
        return yield* Effect.fail(
          new Error('This Workspace is no longer active or is being removed.'),
        )
    }).pipe(
      Effect.mapError(
        (error) =>
          new Error('Action start was refused: the Workspace must be active.', { cause: error }),
      ),
    )
  return { withWorkspaceMutation, requireActive }
}

export const WorkspaceExecutionAdmissionLive = Layer.effect(
  WorkspaceExecutionAdmission,
  Effect.map(SqlClient.SqlClient, createActionWorkspaceAdmission),
)
