import {
  SESSION_HOST_PROJECT_ACTION_MIGRATION_ID,
  SESSION_HOST_PROJECT_ACTION_RUN_POLLING_MIGRATION_ID,
} from './session-host-schema-identity'

export const PROJECT_ACTION_MIGRATION = {
  id: SESSION_HOST_PROJECT_ACTION_MIGRATION_ID,
  name: 'native-project-actions',
  statements: [
    `CREATE TABLE workspace_preparation (
      workspace_id TEXT PRIMARY KEY REFERENCES workspace_resources(id) ON DELETE CASCADE,
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
      workspace_id TEXT NOT NULL REFERENCES workspace_resources(id) ON DELETE CASCADE,
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
    `CREATE TABLE project_action_history_cleanup (workspace_id TEXT PRIMARY KEY)`,
    `CREATE TRIGGER queue_workspace_action_history_cleanup BEFORE DELETE ON workspace_resources
      WHEN EXISTS (SELECT 1 FROM project_action_runs WHERE workspace_id = OLD.id)
      BEGIN
        INSERT OR IGNORE INTO project_action_history_cleanup (workspace_id) VALUES (OLD.id);
      END`,
  ],
} as const

export const PROJECT_ACTION_RUN_POLLING_MIGRATION = {
  id: SESSION_HOST_PROJECT_ACTION_RUN_POLLING_MIGRATION_ID,
  name: 'project-action-run-polling-indexes',
  statements: [
    `CREATE INDEX project_action_runs_active ON project_action_runs (workspace_id, started_at DESC, id DESC)
      WHERE status IN ('starting', 'running', 'stopping')`,
    `CREATE INDEX project_action_runs_recent ON project_action_runs (workspace_id, started_at DESC, id DESC)
      WHERE status NOT IN ('starting', 'running', 'stopping')`,
  ],
} as const

export const PROJECT_ACTION_MIGRATIONS = [
  PROJECT_ACTION_MIGRATION,
  PROJECT_ACTION_RUN_POLLING_MIGRATION,
] as const
