import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import type {
  SessionWorkspaceResource,
  WorkspaceOccupant,
} from '../ports/session-workspace-resource-repository'

interface OccupantRow {
  readonly session_id: string
  readonly title: string
  readonly archived: number
  readonly session_project_path: string | null
  readonly active_run_id: string | null
  readonly workspace_id: string | null
  readonly kind: SessionWorkspaceResource['kind'] | null
  readonly working_path: string | null
}

/**
 * Sessions that can keep a worktree in use, with the Workspace each works in: every Session that
 * is not archived or has an active Run, and every Session bound to a managed worktree, archived
 * or not, so Settings can name a worktree's owner.
 */
export function listWorkspaceOccupants(sql: SqlClient.SqlClient) {
  return sql<OccupantRow>`
    SELECT sessions.id AS session_id, sessions.title, sessions.archived,
      sessions.project_path AS session_project_path, states.active_run_id,
      resources.id AS workspace_id, resources.kind, resources.working_path
    FROM sessions
    LEFT JOIN session_workspace_bindings AS bindings ON bindings.session_id = sessions.id
    LEFT JOIN workspace_resources AS resources ON resources.id = bindings.workspace_id
    LEFT JOIN session_control_states AS states ON states.session_id = sessions.id
    WHERE sessions.archived = 0
      OR states.active_run_id IS NOT NULL
      OR resources.kind = ${'managed-worktree'}
  `.pipe(
    Effect.map((rows) =>
      rows.map(
        (row): WorkspaceOccupant => ({
          sessionId: row.session_id,
          title: row.title,
          archived: row.archived !== 0,
          activeRun: row.active_run_id !== null,
          sessionProjectPath: row.session_project_path,
          workspace:
            row.workspace_id !== null && row.kind !== null && row.working_path !== null
              ? { id: row.workspace_id, kind: row.kind, workingPath: row.working_path }
              : null,
        }),
      ),
    ),
    Effect.mapError(
      (cause) => new Error('Failed to list the Sessions using Workspaces.', { cause }),
    ),
  )
}
