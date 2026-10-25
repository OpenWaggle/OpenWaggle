import type * as SqlClient from '@effect/sql/SqlClient'
import type { SessionQueryRequest } from '@shared/types/session-query'
import * as Effect from 'effect/Effect'

type CatalogQuery = Extract<
  SessionQueryRequest['query'],
  { operation: 'list' | 'search' | 'delegations-list' | 'delegations-conflicts' }
>

function isCatalogQuery(query: SessionQueryRequest['query']): query is CatalogQuery {
  return (
    query.operation === 'list' ||
    query.operation === 'search' ||
    query.operation === 'delegations-list' ||
    query.operation === 'delegations-conflicts'
  )
}

/**
 * The project a working path stands for, by the Host's Workspace-to-project rule
 * (`projectOfWorkspacePath` with `insideManagedWorktrees`): a Session's managed worktree, or a
 * directory inside one, is that Session's project; any other path is the project at that path.
 */
function projectOfWorkingPath(sql: SqlClient.SqlClient, workingPath: string) {
  return sql<{ readonly project_path: string }>`
    SELECT sessions.project_path FROM workspace_resources
    JOIN session_workspace_bindings
      ON session_workspace_bindings.workspace_id = workspace_resources.id
    JOIN sessions ON sessions.id = session_workspace_bindings.session_id
    WHERE workspace_resources.kind = ${'managed-worktree'}
      AND (workspace_resources.working_path = ${workingPath}
        OR substr(${workingPath}, 1, length(workspace_resources.working_path) + 1)
          IN (workspace_resources.working_path || '/', workspace_resources.working_path || '\\'))
      AND sessions.project_path IS NOT NULL AND sessions.project_path != ''
    ORDER BY length(workspace_resources.working_path) DESC
    LIMIT 1
  `.pipe(Effect.map((rows) => rows[0]?.project_path ?? workingPath))
}

/**
 * A catalog query's `workingPath` means the caller's current project, with every worktree of it
 * (issue #352): rewrite it to that project before the catalog filters by `projectPath`. This runs
 * after authorization, which treats a query without `projectPath` as discovery bounded by the
 * caller's scope, so a Worker sees the Sessions of its Hive in its project. An explicit
 * `projectPath` wins over `workingPath`.
 */
export function resolveCurrentProjectQuery(
  sql: SqlClient.SqlClient,
  request: SessionQueryRequest,
): Effect.Effect<SessionQueryRequest, unknown> {
  const query = request.query
  if (!isCatalogQuery(query) || query.workingPath === undefined) return Effect.succeed(request)
  const { workingPath, ...rest } = query
  if (rest.projectPath !== undefined) return Effect.succeed({ ...request, query: rest })
  return projectOfWorkingPath(sql, workingPath).pipe(
    Effect.map((projectPath) => ({ ...request, query: { ...rest, projectPath } })),
  )
}
