import type { DatabaseSync } from 'node:sqlite'
import { queryCutoverRecord } from './session-host-cutover-database'

export function validateSessionHostWorkspaceBindingProjects(database: DatabaseSync) {
  const mismatched = queryCutoverRecord(
    database,
    `SELECT COUNT(*) AS count
      FROM sessions
      JOIN session_workspace_bindings AS bindings ON bindings.session_id = sessions.id
      JOIN workspace_resources AS workspaces ON workspaces.id = bindings.workspace_id
      WHERE sessions.project_path IS NOT NULL
        AND sessions.project_path <> workspaces.project_path`,
  )?.count
  if (mismatched !== 0) {
    throw new Error('Workspace binding project identity does not match its Session.')
  }
}
