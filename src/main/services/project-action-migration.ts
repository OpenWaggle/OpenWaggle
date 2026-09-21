import { SESSION_HOST_PROJECT_ACTION_MIGRATION_ID } from './session-host-schema-identity'

export const PROJECT_ACTION_MIGRATION = {
  id: SESSION_HOST_PROJECT_ACTION_MIGRATION_ID,
  name: 'native-project-actions',
  statements: [
    `CREATE TABLE workspace_preparation (
      workspace_id TEXT PRIMARY KEY,
      revision INTEGER NOT NULL CHECK (revision > 0),
      state_json TEXT NOT NULL CHECK (json_valid(state_json))
    )`,
    `CREATE TABLE project_action_catalogs (
      project_path TEXT PRIMARY KEY,
      revision INTEGER NOT NULL CHECK (revision > 0),
      state_json TEXT NOT NULL CHECK (json_valid(state_json)),
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE project_action_runs (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      action_id TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      record_json TEXT NOT NULL CHECK (json_valid(record_json))
    )`,
    `CREATE INDEX project_action_runs_workspace ON project_action_runs (workspace_id, started_at DESC)`,
    `CREATE TABLE project_action_run_requests (
      workspace_id TEXT NOT NULL,
      action_id TEXT NOT NULL,
      request_id TEXT NOT NULL,
      run_id TEXT NOT NULL REFERENCES project_action_runs(id) ON DELETE CASCADE,
      PRIMARY KEY (workspace_id, action_id, request_id)
    )`,
  ],
} as const
